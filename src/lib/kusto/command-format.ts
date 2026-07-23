/** Quotes Kusto entity names only when the simple identifier syntax cannot represent them. */
export function quoteKustoEntity(name: string, emptyMessage = 'Enter an entity name.') {
	const entity = name.trim();
	if (!entity) throw new Error(emptyMessage);
	return /^[A-Za-z_][A-Za-z0-9_]*$/.test(entity) ? entity : `['${entity.replaceAll("'", "''")}']`;
}

/** Quotes a Kusto string literal while preserving arbitrary user-entered text. */
export function quoteKustoString(value: string) {
	return `'${value.replaceAll("'", "''")}'`;
}
