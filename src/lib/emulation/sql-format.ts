/** Quotes a DuckDB identifier and rejects empty names before SQL is constructed. */
export function quoteDuckDbIdentifier(value: string) {
	const name = value.trim();
	if (!name) throw new Error('DuckDB identifiers cannot be empty.');
	return `"${name.replaceAll('"', '""')}"`;
}

/** Quotes a DuckDB string literal. */
export function quoteDuckDbString(value: string) {
	return `'${value.replaceAll("'", "''")}'`;
}

/** Returns a table reference in an attached DuckDB database's main schema. */
export function qualifyDuckDbTable(database: string, table: string) {
	return `${quoteDuckDbIdentifier(database)}.main.${quoteDuckDbIdentifier(table)}`;
}
