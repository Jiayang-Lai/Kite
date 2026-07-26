import type { Column, Database, Function as MonacoKustoFunction, Table } from '@kusto/monaco-kusto';

/** Schema entities owned by Monaco-Kusto use the package's public definitions. */
export type KustoColumn = Column;
export type KustoTable = Table;
export type KustoFunction = MonacoKustoFunction;

/**
 * Kite accepts a compact database definition and supplies Monaco-Kusto's required
 * empty collections and version defaults at the worker boundary.
 */
export type KustoDatabase = Pick<Database, 'name' | 'tables'> &
	Partial<
		Pick<
			Database,
			'alternateName' | 'functions' | 'graphs' | 'entityGroups' | 'majorVersion' | 'minorVersion'
		>
	> & {
		/** Friendly remote database label returned by `.show databases details`. */
		prettyName?: string;
	};

export type KustoDatabaseSchema = Record<string, KustoDatabase>;
