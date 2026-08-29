/** Converts SDK-specific values into values that can safely cross UI boundaries. */
export function normalizeResultValue(value: unknown): unknown {
	if (value instanceof Date) return value.toISOString();
	if (typeof value === 'bigint') return value.toString();
	if (Array.isArray(value)) return value.map(normalizeResultValue);
	if (value && typeof value === 'object') {
		return Object.fromEntries(
			Object.entries(value as Record<string, unknown>).map(([key, item]) => [
				key,
				normalizeResultValue(item)
			])
		);
	}
	return value;
}
