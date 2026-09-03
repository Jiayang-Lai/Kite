import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const workerMocks = vi.hoisted(() => ({ instances: [] as FakeWorker[] }));

class FakeWorker {
	onmessage: ((event: MessageEvent) => void) | null = null;
	onerror: (() => void) | null = null;
	onmessageerror: (() => void) | null = null;
	postMessage = vi.fn();
	terminate = vi.fn();

	constructor() {
		workerMocks.instances.push(this);
	}
}

vi.mock('$lib/workers/kql-translator.worker?worker', () => ({ default: FakeWorker }));

import {
	disposeKqlTranslator,
	kqlTranslatorIdleTimeoutMs,
	translateKqlToSql
} from './wasm-translator';

const result = { success: true, sql: 'SELECT 1', error: null, render: null };

async function startedTranslation(kql = 'print value = 1') {
	const promise = translateKqlToSql(kql);
	await vi.waitFor(() => expect(workerMocks.instances).toHaveLength(1));
	const worker = workerMocks.instances[0];
	const request = worker.postMessage.mock.calls[0][0] as { id: number; kql: string };
	return { promise, worker, request };
}

beforeEach(() => {
	workerMocks.instances.length = 0;
	vi.stubGlobal('Worker', FakeWorker);
});

afterEach(() => {
	disposeKqlTranslator();
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe('KQL WASM translator lifecycle', () => {
	it('reuses one worker and resolves responses by request id', async () => {
		const first = await startedTranslation();
		const secondPromise = translateKqlToSql('print value = 2');
		await vi.waitFor(() => expect(first.worker.postMessage).toHaveBeenCalledTimes(2));
		const secondRequest = first.worker.postMessage.mock.calls[1][0] as { id: number };

		first.worker.onmessage?.({
			data: { type: 'result', id: secondRequest.id, result }
		} as MessageEvent);
		first.worker.onmessage?.({
			data: { type: 'result', id: first.request.id, result }
		} as MessageEvent);

		await expect(first.promise).resolves.toEqual(result);
		await expect(secondPromise).resolves.toEqual(result);
		expect(workerMocks.instances).toHaveLength(1);
	});

	it('rejects non-fatal errors without terminating the reusable worker', async () => {
		const translation = await startedTranslation();
		translation.worker.onmessage?.({
			data: { type: 'error', id: translation.request.id, message: 'Invalid KQL' }
		} as MessageEvent);

		await expect(translation.promise).rejects.toThrow('Invalid KQL');
		expect(translation.worker.terminate).not.toHaveBeenCalled();
	});

	it('terminates the worker and rejects every pending request after a fatal error', async () => {
		const first = await startedTranslation();
		const second = translateKqlToSql('print value = 2');
		await vi.waitFor(() => expect(first.worker.postMessage).toHaveBeenCalledTimes(2));
		first.worker.onmessage?.({
			data: { type: 'error', id: first.request.id, message: 'Runtime failed', fatal: true }
		} as MessageEvent);

		await expect(first.promise).rejects.toThrow('Runtime failed');
		await expect(second).rejects.toThrow('failed to initialize');
		expect(first.worker.terminate).toHaveBeenCalledOnce();
	});

	it('rejects pending work on worker and message errors', async () => {
		const crashed = await startedTranslation();
		crashed.worker.onerror?.();
		await expect(crashed.promise).rejects.toThrow('stopped unexpectedly');

		workerMocks.instances.length = 0;
		const malformed = await startedTranslation();
		malformed.worker.onmessageerror?.();
		await expect(malformed.promise).rejects.toThrow('invalid message');
	});

	it('surfaces postMessage failures and releases an idle worker', async () => {
		vi.useFakeTimers();
		const promise = translateKqlToSql('print value = 1');
		await vi.waitFor(() => expect(workerMocks.instances).toHaveLength(1));
		const worker = workerMocks.instances[0];
		worker.postMessage.mockImplementationOnce(() => {
			throw new Error('Clone failed');
		});

		// The first call happened before the mock was installed; finish it and exercise the idle timer.
		const request = worker.postMessage.mock.calls[0][0] as { id: number };
		worker.onmessage?.({ data: { type: 'result', id: request.id, result } } as MessageEvent);
		await expect(promise).resolves.toEqual(result);
		await vi.advanceTimersByTimeAsync(kqlTranslatorIdleTimeoutMs);
		expect(worker.terminate).toHaveBeenCalledOnce();

		workerMocks.instances.length = 0;
		const rejected = translateKqlToSql('print value = 2');
		await vi.waitFor(() => expect(workerMocks.instances).toHaveLength(1));
		workerMocks.instances[0].postMessage.mockImplementationOnce(() => {
			throw 'Clone failed';
		});
		// Trigger another request so the configured throwing implementation is used.
		await expect(translateKqlToSql('print value = 3')).rejects.toThrow('Clone failed');
		disposeKqlTranslator();
		await expect(rejected).rejects.toThrow('disposed');
	});

	it('dispose rejects pending work and is safe to call repeatedly', async () => {
		const translation = await startedTranslation();
		disposeKqlTranslator();
		disposeKqlTranslator();

		await expect(translation.promise).rejects.toThrow('disposed');
		expect(translation.worker.terminate).toHaveBeenCalledOnce();
	});
});
