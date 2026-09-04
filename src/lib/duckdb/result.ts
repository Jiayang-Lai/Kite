export type DuckDbQueryResult = {
	columns: Array<{ name: string; type: string }>;
	rows: unknown[][];
	elapsedMs: number;
};

type ArrowLikeTable = {
	schema: { fields: readonly { name: string; type: { toString(): string } }[] };
	toArray(): readonly unknown[];
};

/** Converts values crossing the DuckDB/Arrow boundary into renderer-safe data. */
export function normalizeDuckDbValue(value: unknown): unknown {
	if (value instanceof Date) return value.toISOString();
	if (typeof value === 'bigint') return value.toString();
	if (value instanceof Uint8Array) return Array.from(value);
	if (Array.isArray(value)) return value.map(normalizeDuckDbValue);
	if (value && typeof value === 'object') {
		return Object.fromEntries(
			Object.entries(value as Record<string, unknown>).map(([key, item]) => [
				key,
				normalizeDuckDbValue(item)
			])
		);
	}
	return value;
}

/** Materializes an Arrow-like result independently from session and worker ownership. */
export function materializeDuckDbResult(
	table: ArrowLikeTable,
	elapsedMs: number
): DuckDbQueryResult {
	const columns = table.schema.fields.map((field) => ({
		name: field.name,
		type: field.type.toString()
	}));

	return {
		columns,
		rows: table
			.toArray()
			.map((row) =>
				columns.map((column) => normalizeDuckDbValue((row as Record<string, unknown>)[column.name]))
			),
		elapsedMs
	};
}
