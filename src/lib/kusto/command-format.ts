/**
 * Escapes text for the body of a single-quoted Kusto string literal. Kusto uses backslash
 * escapes; doubling a quote (`''`) does not produce a quote and must not be used.
 */
export function escapeKustoStringBody(value: string) {
	return value.replaceAll('\\', '\\\\').replaceAll("'", "\\'");
}

/** Quotes Kusto entity names only when the simple identifier syntax cannot represent them. */
export function quoteKustoEntity(name: string, emptyMessage = 'Enter an entity name.') {
	const entity = name.trim();
	if (!entity) throw new Error(emptyMessage);
	return /^[A-Za-z_][A-Za-z0-9_]*$/.test(entity) ? entity : `['${escapeKustoStringBody(entity)}']`;
}

/** Quotes a Kusto string literal while preserving arbitrary user-entered text. */
export function quoteKustoString(value: string) {
	return `'${escapeKustoStringBody(value)}'`;
}
