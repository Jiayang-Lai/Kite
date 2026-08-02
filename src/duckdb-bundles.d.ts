declare module '#kite-duckdb-bundles' {
	import type { DuckDBBundles } from '@duckdb/duckdb-wasm';

	const bundles: DuckDBBundles;
	export default bundles;
}
