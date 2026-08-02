import * as duckdb from '@duckdb/duckdb-wasm';
import duckdbEhWorker from '@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url';
import duckdbMvpWorker from '@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url';

// Cloudflare Pages cannot serve DuckDB's runtime WASM files because each exceeds
// its 25 MiB per-file deployment limit. Keep the workers on Kite's origin while
// DuckDB supplies version-pinned CDN URLs for the corresponding WASM modules.
const cdnBundles = duckdb.getJsDelivrBundles();
const bundles: duckdb.DuckDBBundles = {
	mvp: {
		mainModule: cdnBundles.mvp.mainModule,
		mainWorker: duckdbMvpWorker
	},
	...(cdnBundles.eh
		? {
				eh: {
					mainModule: cdnBundles.eh.mainModule,
					mainWorker: duckdbEhWorker
				}
			}
		: {})
};

export default bundles;
