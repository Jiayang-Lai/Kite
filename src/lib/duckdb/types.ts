export type DuckDbQueryResult = {
	columns: Array<{
		name: string;
		type: string;
	}>;
	rows: unknown[][];
	elapsedMs: number;
};

export type DuckDbCatalogSchema = {
	name: string;
	tables: string[];
};

export type DuckDbCatalogDatabase = {
	name: string;
	isCurrent: boolean;
	schemas: DuckDbCatalogSchema[];
};
