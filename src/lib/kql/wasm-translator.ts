import type {
	KqlTranslationResult,
	KqlTranslatorRequest,
	KqlTranslatorResponse
} from './translator-protocol';

export type { KqlTranslationResult } from './translator-protocol';

const IDLE_TIMEOUT_MS = 30_000;

type PendingTranslation = {
	resolve: (result: KqlTranslationResult) => void;
	reject: (error: Error) => void;
};

type TranslatorWorkerState = {
	worker: Worker;
	pending: Map<number, PendingTranslation>;
	idleTimer: ReturnType<typeof setTimeout> | undefined;
	terminated: boolean;
};

type TranslatorWorkerConstructor = new () => Worker;

let workerState: TranslatorWorkerState | undefined;
let creatingWorker: Promise<TranslatorWorkerState> | undefined;
let lifecycleVersion = 0;
let nextRequestId = 0;

function clearIdleTimer(state: TranslatorWorkerState) {
	if (!state.idleTimer) return;
	clearTimeout(state.idleTimer);
	state.idleTimer = undefined;
}

function rejectPending(state: TranslatorWorkerState, error: Error) {
	for (const { reject } of state.pending.values()) reject(error);
	state.pending.clear();
}

function terminateState(state: TranslatorWorkerState, error: Error) {
	if (state.terminated) return;
	state.terminated = true;
	clearIdleTimer(state);
	state.worker.onmessage = null;
	state.worker.onerror = null;
	state.worker.onmessageerror = null;
	state.worker.terminate();
	rejectPending(state, error);
	if (workerState === state) workerState = undefined;
}

function scheduleIdleTermination(state: TranslatorWorkerState) {
	if (state.terminated || state.pending.size !== 0) return;
	clearIdleTimer(state);
	state.idleTimer = setTimeout(() => {
		if (workerState !== state || state.pending.size !== 0) return;
		terminateState(state, new Error('The KQL translator worker was released after being idle.'));
	}, IDLE_TIMEOUT_MS);
}

function handleMessage(state: TranslatorWorkerState, event: MessageEvent<KqlTranslatorResponse>) {
	const response = event.data;
	const pending = state.pending.get(response.id);
	if (!pending) return;

	state.pending.delete(response.id);
	if (response.type === 'result') {
		pending.resolve(response.result);
	} else {
		pending.reject(new Error(response.message));
		if (response.fatal) {
			terminateState(state, new Error('The KQL translator worker failed to initialize.'));
			return;
		}
	}

	scheduleIdleTermination(state);
}

async function createWorker() {
	if (typeof Worker === 'undefined') {
		throw new Error('The KQL translator is available only in a browser.');
	}

	const version = lifecycleVersion;
	const { default: KqlTranslatorWorker } =
		(await import('$lib/workers/kql-translator.worker?worker')) as {
			default: TranslatorWorkerConstructor;
		};
	const worker = new KqlTranslatorWorker();
	const state: TranslatorWorkerState = {
		worker,
		pending: new Map(),
		idleTimer: undefined,
		terminated: false
	};

	if (version !== lifecycleVersion) {
		terminateState(state, new Error('The KQL translator worker was disposed before it started.'));
		throw new Error('The KQL translator worker was disposed before it started.');
	}

	worker.onmessage = (event) => handleMessage(state, event as MessageEvent<KqlTranslatorResponse>);
	worker.onerror = () => {
		terminateState(state, new Error('The KQL translator worker stopped unexpectedly.'));
	};
	worker.onmessageerror = () => {
		terminateState(state, new Error('The KQL translator worker returned an invalid message.'));
	};
	workerState = state;
	return state;
}

async function getWorker() {
	if (workerState && !workerState.terminated) return workerState;
	const creation = (creatingWorker ??= createWorker());

	try {
		return await creation;
	} finally {
		if (creatingWorker === creation) creatingWorker = undefined;
	}
}

/** Terminates the dedicated worker and releases its Mono/WASM runtime. */
export function disposeKqlTranslator() {
	lifecycleVersion += 1;
	creatingWorker = undefined;
	if (workerState) {
		terminateState(workerState, new Error('The KQL translator worker was disposed.'));
	}
}

/** Translates KQL to the dialect consumed by DuckDB-Wasm. */
export async function translateKqlToSql(kql: string): Promise<KqlTranslationResult> {
	const state = await getWorker();
	if (state.terminated) throw new Error('The KQL translator worker was disposed.');

	clearIdleTimer(state);
	const id = ++nextRequestId;
	return new Promise<KqlTranslationResult>((resolve, reject) => {
		state.pending.set(id, { resolve, reject });
		try {
			state.worker.postMessage({ type: 'translate', id, kql } satisfies KqlTranslatorRequest);
		} catch (error) {
			state.pending.delete(id);
			reject(error instanceof Error ? error : new Error(String(error)));
			scheduleIdleTermination(state);
		}
	});
}

export const kqlTranslatorIdleTimeoutMs = IDLE_TIMEOUT_MS;
