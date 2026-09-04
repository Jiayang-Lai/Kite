export function quoteDuckDbIdentifier(value: string) {
	return `"${value.replaceAll('"', '""')}"`;
}

export function quoteDuckDbString(value: string) {
	return `'${value.replaceAll("'", "''")}'`;
}

/** Rewrites logical persistent-database SQL to the private OPFS catalog layout. */
export function rewritePersistentDuckDbSql(
	sql: string,
	storageMode: 'memory' | 'opfs',
	internalCatalogName?: string
) {
	if (storageMode !== 'opfs' || !internalCatalogName) return sql;

	const withSelectedSchema = sql.replace(
		/(^|;)\s*USE\s+"((?:[^"]|"")*)"\s*;?/gim,
		(_match, prefix: string, encodedName: string) =>
			`${prefix}\nSET schema = ${quoteDuckDbString(encodedName.replaceAll('""', '"'))};`
	);

	return withSelectedSchema.replace(
		/("(?:[^"]|"")*")\s*\.\s*(?:"main"|main)\s*\.\s*("(?:[^"]|"")*")/gi,
		`${quoteDuckDbIdentifier(internalCatalogName)}.$1.$2`
	);
}
