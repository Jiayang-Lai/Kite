import * as duckdb from '@duckdb/duckdb-wasm';
import duckdbEhWasm from '@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url';
import duckdbEhWorker from '@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url';
import duckdbMvpWasm from '@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url';
import duckdbMvpWorker from '@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url';

// Static container builds can ship the full runtime, allowing DuckDB to load
// both its worker and WASM module from the same Kite origin.
const bundles: duckdb.DuckDBBundles = {
	mvp: {
		mainModule: duckdbMvpWasm,
		mainWorker: duckdbMvpWorker
	},
	eh: {
		mainModule: duckdbEhWasm,
		mainWorker: duckdbEhWorker
	}
};

export default bundles;
