import type {
	KqlTranslationResult,
	KqlTranslatorRequest,
	KqlTranslatorResponse
} from '$lib/kql/translator-protocol';

const DOTNET_LOADER_PATH = '/kql-wasm/_framework/dotnet.js';
const BRIDGE_ASSEMBLY_NAME = 'KqlWasmBridge';

type KqlBridgeExports = {
	KqlWasmBridge: {
		KqlBridge: {
			TranslateKqlToSql: (kql: string, dialect: string) => string;
		};
	};
};

type DotnetRuntime = {
	getAssemblyExports: (assemblyName: string) => Promise<KqlBridgeExports>;
};

type DotnetLoader = {
	dotnet: {
		create: () => Promise<DotnetRuntime>;
	};
};

let bridgePromise: Promise<KqlBridgeExports> | undefined;

async function loadBridge() {
	bridgePromise ??= (async () => {
		const loader = (await import(/* @vite-ignore */ DOTNET_LOADER_PATH)) as DotnetLoader;
		const runtime = await loader.dotnet.create();
		return runtime.getAssemblyExports(BRIDGE_ASSEMBLY_NAME);
	})();

	try {
		return await bridgePromise;
	} catch (error) {
		// A startup failure must not poison a later retry in this worker.
		bridgePromise = undefined;
		throw error;
	}
}

function post(response: KqlTranslatorResponse) {
	self.postMessage(response);
}

self.addEventListener('message', async (event: MessageEvent<KqlTranslatorRequest>) => {
	const request = event.data;
	if (request.type !== 'translate') return;

	try {
		const bridge = await loadBridge();
		const serializedResult = bridge.KqlWasmBridge.KqlBridge.TranslateKqlToSql(
			request.kql,
			'duckdb'
		);
		let result: KqlTranslationResult;
		try {
			result = JSON.parse(serializedResult) as KqlTranslationResult;
		} catch {
			throw new Error('The KQL translator returned an invalid response.');
		}

		post({ type: 'result', id: request.id, result });
	} catch (error) {
		post({
			type: 'error',
			id: request.id,
			message: error instanceof Error ? error.message : String(error),
			fatal: !bridgePromise
		});
	}
});
