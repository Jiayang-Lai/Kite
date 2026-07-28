const DOTNET_LOADER_PATH = '/kql-wasm/_framework/dotnet.js';
const BRIDGE_ASSEMBLY_NAME = 'KqlWasmBridge';

export type KqlTranslationResult = {
	success: boolean;
	sql: string | null;
	error: string | null;
	render: unknown;
};

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

	return bridgePromise;
}

/** Translates KQL to the dialect consumed by DuckDB-Wasm. */
export async function translateKqlToSql(kql: string): Promise<KqlTranslationResult> {
	const bridge = await loadBridge();
	const serializedResult = bridge.KqlWasmBridge.KqlBridge.TranslateKqlToSql(kql, 'duckdb');

	try {
		return JSON.parse(serializedResult) as KqlTranslationResult;
	} catch {
		throw new Error('The KQL translator returned an invalid response.');
	}
}
