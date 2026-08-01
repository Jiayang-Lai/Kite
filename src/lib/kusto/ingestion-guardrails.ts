import type { InlineCsvPlan } from './inline-file';

export type IngestionTargetColumn = { name: string; type: string };

export type IngestionGuardrail = {
	id: 'column-count' | 'inconsistent-row-width' | 'header-order';
	message: string;
};

/**
 * Returns non-blocking warnings for positional CSV ingestion. Header names are
 * informational: values are still assigned according to target column order.
 */
export function compareCsvShape(
	plan: Pick<
		InlineCsvPlan,
		'columnCount' | 'inconsistentRecordCount' | 'headerColumns' | 'headerColumnCount'
	>,
	targetColumns: readonly IngestionTargetColumn[]
): IngestionGuardrail[] {
	const warnings: IngestionGuardrail[] = [];
	if (plan.columnCount !== targetColumns.length) {
		warnings.push({
			id: 'column-count',
			message: `Source rows have ${plan.columnCount} columns; the target table has ${targetColumns.length}.`
		});
	}
	if (plan.inconsistentRecordCount) {
		warnings.push({
			id: 'inconsistent-row-width',
			message: `${plan.inconsistentRecordCount.toLocaleString()} source rows have a different column count.`
		});
	}
	if (
		plan.headerColumns &&
		plan.headerColumnCount === targetColumns.length &&
		plan.headerColumns.some((name, index) => name !== targetColumns[index]?.name)
	) {
		warnings.push({
			id: 'header-order',
			message:
				'CSV header names or order differ from the target. Ingestion still assigns values by column position.'
		});
	}
	return warnings;
}
