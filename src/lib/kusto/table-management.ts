import { quoteKustoEntity, quoteKustoString } from './command-format';
import type { KustoTable } from '$lib/types/kusto-schema';
import type { QueryResult } from '$lib/types/query-result';

export const KUSTO_SCALAR_TYPES = [
	'bool',
	'datetime',
	'decimal',
	'dynamic',
	'guid',
	'int',
	'long',
	'real',
	'string',
	'timespan'
] as const;

export type KustoScalarType = (typeof KUSTO_SCALAR_TYPES)[number];

export type NewTableColumn = {
	name: string;
	type: KustoScalarType;
};

export type CreateTablePlan = {
	kind: 'create-table';
	command: string;
	tableName: string;
	columns: readonly NewTableColumn[];
	docstring: string;
	folder: string;
	risk: 'safe';
	summary: string;
};

export type TableSchemaColumnDraft = {
	/** Index of the original column represented by this row; absent for a new column. */
	sourceIndex?: number;
	name: string;
	type: string;
};

export type TableSchemaChangeKind = 'added' | 'removed' | 'reordered' | 'renamed' | 'type-changed';

export type TableSchemaDiffColumn = {
	name: string;
	type: string;
	index: number;
};

export type TableSchemaDiffRow = {
	sourceIndex?: number;
	before?: TableSchemaDiffColumn;
	after?: TableSchemaDiffColumn;
	changes: readonly TableSchemaChangeKind[];
};

export type TableSchemaDiff = {
	rows: readonly TableSchemaDiffRow[];
	counts: Record<TableSchemaChangeKind, number>;
	hasChanges: boolean;
};

export type TableMutationInput = {
	tableName: string;
	currentDocstring?: string;
	nextDocstring: string;
	existingColumnNames: readonly string[];
	newColumns: readonly NewTableColumn[];
};

export type TableMutationRisk = 'safe' | 'destructive' | 'irreversible';

type TableMutationPlanBase = {
	command: string;
	risk: TableMutationRisk;
	summary: string;
};

export type UpdateTablePlan = TableMutationPlanBase & {
	kind: 'update-table';
	addedColumns: readonly NewTableColumn[];
	updatesDocstring: boolean;
	nextDocstring: string;
};

export type RenameColumnPlan = TableMutationPlanBase & {
	kind: 'rename-column';
	columnName: string;
	newColumnName: string;
};

export type DropColumnPlan = TableMutationPlanBase & {
	kind: 'drop-column';
	columnName: string;
};

export type ChangeColumnTypePlan = TableMutationPlanBase & {
	kind: 'change-column-type';
	columnName: string;
	currentColumnType: string;
	newColumnType: KustoScalarType;
};

export type ReorderTableColumnsPlan = TableMutationPlanBase & {
	kind: 'reorder-table-columns';
	columns: readonly NewTableColumn[];
	diff: TableSchemaDiff;
	preservedDocstring: string;
	preservedFolder: string;
};

export type TableMutationPlan =
	| UpdateTablePlan
	| RenameColumnPlan
	| DropColumnPlan
	| ChangeColumnTypePlan
	| ReorderTableColumnsPlan;

export type TableSchemaColumnSnapshot = {
	name: string;
	type: string;
};

export type TableSchemaSnapshot = {
	databaseName: string;
	tableName: string;
	columns: readonly TableSchemaColumnSnapshot[];
	docstring: string;
	folder?: string;
	cslSchema?: string;
	tableId?: string;
	totalRowCount?: number;
};

export type TableSnapshotConflictKind =
	| 'identity'
	| 'table-recreated'
	| 'column-count'
	| 'column'
	| 'docstring'
	| 'folder'
	| 'csl-schema';

export type TableSnapshotConflict = {
	kind: TableSnapshotConflictKind;
	message: string;
};

type ShowTableSchema = {
	Name?: string;
	DocString?: string;
	OrderedColumns?: Array<{
		Name?: string;
		Type?: string;
		CslType?: string;
	}>;
};

function normalizeDocstring(value?: string) {
	return value?.trim() ?? '';
}

function validateColumns(
	existingColumnNames: readonly string[],
	newColumns: readonly NewTableColumn[]
) {
	const knownNames = new Set(existingColumnNames.map((name) => name.trim().toLowerCase()));
	const validatedColumns: NewTableColumn[] = [];

	for (const column of newColumns) {
		const name = column.name.trim();
		if (!name) throw new Error('Enter a name for every new column.');

		const normalizedName = name.toLowerCase();
		if (knownNames.has(normalizedName)) {
			throw new Error(`Column names must be unique. “${name}” is already in the table draft.`);
		}
		knownNames.add(normalizedName);

		if (!KUSTO_SCALAR_TYPES.includes(column.type)) {
			throw new Error(`“${column.type}” is not a supported Kusto scalar type.`);
		}
		validatedColumns.push({ name, type: column.type });
	}

	return validatedColumns;
}

function formatColumn(column: NewTableColumn) {
	return `${quoteKustoEntity(column.name, 'Enter a column name.')}:${column.type}`;
}

/** Builds one empty table creation command with an explicit initial schema. */
export function buildCreateTablePlan(input: {
	tableName: string;
	existingTableNames: readonly string[];
	columns: readonly NewTableColumn[];
	docstring?: string;
	folder?: string;
}): CreateTablePlan {
	const tableName = input.tableName.trim();
	const quotedTableName = quoteKustoEntity(tableName, 'Enter a table name.');
	if (
		input.existingTableNames.some(
			(existingName) => existingName.trim().toLowerCase() === tableName.toLowerCase()
		)
	) {
		throw new Error(`Table “${tableName}” already exists in this database.`);
	}
	if (!input.columns.length) throw new Error('Add at least one column.');

	const columns = validateColumns([], input.columns);
	const docstring = input.docstring?.trim() ?? '';
	const folder = input.folder?.trim() ?? '';
	const properties = [
		docstring ? `docstring = ${quoteKustoString(docstring)}` : '',
		folder ? `folder = ${quoteKustoString(folder)}` : ''
	].filter(Boolean);
	const withClause = properties.length ? ` with (${properties.join(', ')})` : '';

	return {
		kind: 'create-table',
		command: `.create table ${quotedTableName} (${columns.map(formatColumn).join(', ')})${withClause}`,
		tableName,
		columns,
		docstring,
		folder,
		risk: 'safe',
		summary: `created with ${columns.length} ${columns.length === 1 ? 'column' : 'columns'}`
	};
}

function firstResultRecord(result: QueryResult) {
	const row = result.rows[0];
	if (!row) throw new Error('Kusto returned no table metadata.');
	return Object.fromEntries(result.columns.map((column, index) => [column.name, row[index]]));
}

function recordValue(record: Record<string, unknown>, name: string) {
	const entry = Object.entries(record).find(([key]) => key.toLowerCase() === name.toLowerCase());
	return entry?.[1];
}

function optionalString(value: unknown) {
	return value == null ? undefined : String(value);
}

function normalizedMetadataString(value: unknown) {
	return value == null ? '' : String(value);
}

/** Commands used to establish and recheck a table's mutation snapshot. */
export function buildTablePreflightCommands(tableName: string) {
	const table = quoteKustoEntity(tableName, 'Select a target table.');
	return [
		`.show table ${table} schema as json`,
		`.show table ${table} cslschema`,
		`.show table ${table} details`
	] as const;
}

/** Builds an irreversible table removal command without masking races with `ifexists`. */
export function buildDropTableCommand(tableName: string) {
	return `.drop table ${quoteKustoEntity(tableName, 'Select a target table.')}`;
}

/** Captures the schema already loaded into Kite when the editor is opened. */
export function snapshotLoadedTable(databaseName: string, table: KustoTable): TableSchemaSnapshot {
	return {
		databaseName,
		tableName: table.name,
		columns: table.columns.map((column) => ({ name: column.name, type: column.type })),
		docstring: table.docstring ?? ''
	};
}

/** Parses the JSON-schema, CSL-schema, and details results returned by the preflight batch. */
export function parseTablePreflightResults(results: readonly QueryResult[]): TableSchemaSnapshot {
	if (results.length !== 3) {
		throw new Error('Kusto returned an incomplete table preflight.');
	}

	const schemaRecord = firstResultRecord(results[0]);
	const cslRecord = firstResultRecord(results[1]);
	const detailsRecord = firstResultRecord(results[2]);
	const serializedSchema = recordValue(schemaRecord, 'Schema');
	if (typeof serializedSchema !== 'string') {
		throw new Error('Kusto returned no JSON table schema.');
	}

	let parsedSchema: ShowTableSchema;
	try {
		parsedSchema = JSON.parse(serializedSchema) as ShowTableSchema;
	} catch {
		throw new Error('Kusto returned an invalid JSON table schema.');
	}

	const tableName =
		optionalString(recordValue(schemaRecord, 'TableName')) ?? parsedSchema.Name ?? '';
	const databaseName = optionalString(recordValue(schemaRecord, 'DatabaseName')) ?? '';
	if (!tableName || !databaseName) {
		throw new Error('Kusto returned incomplete table identity metadata.');
	}

	const columns = (parsedSchema.OrderedColumns ?? []).map((column) => {
		const name = column.Name?.trim();
		const type = column.CslType?.trim() || column.Type?.trim();
		if (!name || !type) throw new Error('Kusto returned an invalid table column schema.');
		return { name, type };
	});

	const rowCountValue = recordValue(detailsRecord, 'TotalRowCount');
	const totalRowCount =
		typeof rowCountValue === 'number'
			? rowCountValue
			: typeof rowCountValue === 'string' && rowCountValue.trim()
				? Number(rowCountValue)
				: undefined;

	return {
		databaseName,
		tableName,
		columns,
		docstring: normalizedMetadataString(
			recordValue(schemaRecord, 'DocString') ?? parsedSchema.DocString
		),
		folder: normalizedMetadataString(
			recordValue(schemaRecord, 'Folder') ?? recordValue(detailsRecord, 'Folder')
		),
		cslSchema: optionalString(recordValue(cslRecord, 'Schema')),
		tableId: optionalString(recordValue(detailsRecord, 'TableId')),
		totalRowCount:
			totalRowCount != null && Number.isFinite(totalRowCount) ? totalRowCount : undefined
	};
}

/** Describes concurrent changes that make an editor snapshot unsafe to submit. */
export function compareTableSnapshots(original: TableSchemaSnapshot, current: TableSchemaSnapshot) {
	const conflicts: TableSnapshotConflict[] = [];
	if (original.databaseName !== current.databaseName || original.tableName !== current.tableName) {
		conflicts.push({ kind: 'identity', message: 'The table identity changed.' });
	}
	if (original.tableId && current.tableId && original.tableId !== current.tableId) {
		conflicts.push({ kind: 'table-recreated', message: 'The table was dropped and recreated.' });
	}
	if (original.columns.length !== current.columns.length) {
		conflicts.push({ kind: 'column-count', message: 'The number of columns changed.' });
	} else {
		for (let index = 0; index < original.columns.length; index += 1) {
			const before = original.columns[index];
			const after = current.columns[index];
			if (before.name !== after.name || before.type !== after.type) {
				conflicts.push({
					kind: 'column',
					message: `Column ${index + 1} changed from ${before.name}:${before.type} to ${after.name}:${after.type}.`
				});
			}
		}
	}
	if (original.docstring !== current.docstring) {
		conflicts.push({ kind: 'docstring', message: 'The table description changed.' });
	}
	if (original.folder !== undefined && original.folder !== current.folder) {
		conflicts.push({ kind: 'folder', message: 'The table folder changed.' });
	}
	if (original.cslSchema !== undefined && original.cslSchema !== current.cslSchema) {
		conflicts.push({ kind: 'csl-schema', message: 'The CSL schema changed.' });
	}
	return conflicts;
}

/**
 * Builds the safe table-update subset exposed by Kite's structured editor.
 *
 * Existing columns are intentionally absent from this input: additive updates use
 * `.alter-merge`, while focused column and ordering actions handle existing columns.
 */
export function buildTableMutationPlan(input: TableMutationInput): TableMutationPlan {
	const tableName = quoteKustoEntity(input.tableName, 'Select a target table.');
	const currentDocstring = normalizeDocstring(input.currentDocstring);
	const nextDocstring = normalizeDocstring(input.nextDocstring);
	const updatesDocstring = currentDocstring !== nextDocstring;
	const addedColumns = validateColumns(input.existingColumnNames, input.newColumns);

	if (!updatesDocstring && !addedColumns.length) {
		throw new Error('Change the description or add at least one column before reviewing.');
	}

	const docstringProperty = `docstring = ${quoteKustoString(nextDocstring)}`;
	let command: string;
	if (addedColumns.length) {
		const schema = addedColumns.map(formatColumn).join(', ');
		command = `.alter-merge table ${tableName} (${schema})`;
		if (updatesDocstring) command += ` with (${docstringProperty})`;
	} else {
		command = `.alter table ${tableName} docstring ${quoteKustoString(nextDocstring)}`;
	}

	const changes = [
		addedColumns.length
			? `${addedColumns.length} ${addedColumns.length === 1 ? 'column' : 'columns'} added`
			: '',
		updatesDocstring ? 'description updated' : ''
	].filter(Boolean);

	return {
		kind: 'update-table',
		command,
		addedColumns,
		updatesDocstring,
		nextDocstring,
		risk: 'safe',
		summary: changes.join(' · ')
	};
}

function validatedExistingColumn(
	existingColumnNames: readonly string[],
	columnName: string
): string {
	const requestedName = columnName.trim();
	if (!requestedName) throw new Error('Select a target column.');
	const existingName = existingColumnNames.find((name) => name === requestedName);
	if (!existingName) throw new Error(`Column “${requestedName}” is no longer in the table.`);
	return existingName;
}

/** Builds a data-preserving but reference-breaking single-column rename. */
export function buildRenameColumnPlan(input: {
	tableName: string;
	columnName: string;
	newColumnName: string;
	existingColumnNames: readonly string[];
}): RenameColumnPlan {
	const tableName = quoteKustoEntity(input.tableName, 'Select a target table.');
	const columnName = validatedExistingColumn(input.existingColumnNames, input.columnName);
	const newColumnName = input.newColumnName.trim();
	if (!newColumnName) throw new Error('Enter a new column name.');
	if (newColumnName.toLowerCase() === columnName.toLowerCase()) {
		throw new Error('Enter a different column name.');
	}
	if (
		input.existingColumnNames.some(
			(name) => name !== columnName && name.trim().toLowerCase() === newColumnName.toLowerCase()
		)
	) {
		throw new Error(`Column “${newColumnName}” already exists in this table.`);
	}

	return {
		kind: 'rename-column',
		command: `.rename column ${tableName}.${quoteKustoEntity(columnName, 'Select a target column.')} to ${quoteKustoEntity(newColumnName, 'Enter a new column name.')}`,
		columnName,
		newColumnName,
		risk: 'destructive',
		summary: `${columnName} renamed to ${newColumnName}`
	};
}

/** Builds an irreversible single-column removal without `ifexists` race masking. */
export function buildDropColumnPlan(input: {
	tableName: string;
	columnName: string;
	existingColumnNames: readonly string[];
}): DropColumnPlan {
	const tableName = quoteKustoEntity(input.tableName, 'Select a target table.');
	const columnName = validatedExistingColumn(input.existingColumnNames, input.columnName);
	if (input.existingColumnNames.length <= 1) {
		throw new Error('Kite does not remove the last column from a table.');
	}

	return {
		kind: 'drop-column',
		command: `.drop column ${tableName}.${quoteKustoEntity(columnName, 'Select a target column.')}`,
		columnName,
		risk: 'irreversible',
		summary: `${columnName} removed`
	};
}

/** Builds a direct and irreversible type replacement for one existing column. */
export function buildChangeColumnTypePlan(input: {
	tableName: string;
	columnName: string;
	currentColumnType: string;
	newColumnType: string;
	existingColumnNames: readonly string[];
}): ChangeColumnTypePlan {
	const tableName = quoteKustoEntity(input.tableName, 'Select a target table.');
	const columnName = validatedExistingColumn(input.existingColumnNames, input.columnName);
	const currentColumnType = input.currentColumnType.trim().toLowerCase();
	const newColumnType = input.newColumnType.trim().toLowerCase();

	if (!KUSTO_SCALAR_TYPES.includes(newColumnType as KustoScalarType)) {
		throw new Error('Select a supported new column type.');
	}
	if (newColumnType === currentColumnType) {
		throw new Error('Select a different column type.');
	}

	return {
		kind: 'change-column-type',
		command: `.alter column ${tableName}.${quoteKustoEntity(columnName, 'Select a target column.')} type=${newColumnType}`,
		columnName,
		currentColumnType,
		newColumnType: newColumnType as KustoScalarType,
		risk: 'irreversible',
		summary: `${columnName} changed from ${currentColumnType} to ${newColumnType}`
	};
}

/** Computes an identity-aware before/after schema diff. */
export function diffTableSchema(
	originalColumns: readonly TableSchemaColumnSnapshot[],
	nextColumns: readonly TableSchemaColumnDraft[]
): TableSchemaDiff {
	const draftBySource = new Map<number, { column: TableSchemaColumnDraft; index: number }>();
	for (const [index, column] of nextColumns.entries()) {
		if (column.sourceIndex != null && !draftBySource.has(column.sourceIndex)) {
			draftBySource.set(column.sourceIndex, { column, index });
		}
	}

	const retainedSourceIndexes = originalColumns
		.map((_, index) => index)
		.filter((index) => draftBySource.has(index));
	const retainedOrder = nextColumns
		.filter((column) => column.sourceIndex != null && draftBySource.has(column.sourceIndex))
		.map((column) => column.sourceIndex as number);
	const reorderedSources = new Set(
		retainedOrder.filter((sourceIndex, index) => retainedSourceIndexes[index] !== sourceIndex)
	);

	const rows: TableSchemaDiffRow[] = originalColumns.map((before, sourceIndex) => {
		const draft = draftBySource.get(sourceIndex);
		const beforeColumn = { ...before, index: sourceIndex };
		if (!draft) {
			return {
				sourceIndex,
				before: beforeColumn,
				changes: ['removed']
			};
		}

		const changes: TableSchemaChangeKind[] = [];
		if (before.name !== draft.column.name.trim()) changes.push('renamed');
		if (before.type !== draft.column.type) changes.push('type-changed');
		if (reorderedSources.has(sourceIndex)) changes.push('reordered');
		return {
			sourceIndex,
			before: beforeColumn,
			after: {
				name: draft.column.name.trim(),
				type: draft.column.type,
				index: draft.index
			},
			changes
		};
	});

	for (const [index, column] of nextColumns.entries()) {
		if (column.sourceIndex == null) {
			rows.push({
				after: { name: column.name.trim(), type: column.type, index },
				changes: ['added']
			});
		}
	}

	const counts: Record<TableSchemaChangeKind, number> = {
		added: 0,
		removed: 0,
		reordered: 0,
		renamed: 0,
		'type-changed': 0
	};
	for (const row of rows) {
		for (const change of row.changes) counts[change] += 1;
	}

	return {
		rows,
		counts,
		hasChanges: Object.values(counts).some((count) => count > 0)
	};
}

/**
 * Builds one complete `.alter table` command from a validated permutation.
 * Every verified column is included exactly once with its original name and type.
 */
export function buildReorderTableColumnsPlan(input: {
	snapshot: TableSchemaSnapshot;
	orderedSourceIndexes: readonly number[];
}): ReorderTableColumnsPlan {
	const tableName = quoteKustoEntity(input.snapshot.tableName, 'Select a target table.');
	if (input.orderedSourceIndexes.length !== input.snapshot.columns.length) {
		throw new Error('The reordered schema must contain every verified column exactly once.');
	}

	const seenSourceIndexes = new Set<number>();
	const columns: NewTableColumn[] = input.orderedSourceIndexes.map((sourceIndex) => {
		if (
			!Number.isInteger(sourceIndex) ||
			sourceIndex < 0 ||
			sourceIndex >= input.snapshot.columns.length ||
			seenSourceIndexes.has(sourceIndex)
		) {
			throw new Error('The reordered schema must contain every verified column exactly once.');
		}
		seenSourceIndexes.add(sourceIndex);
		const column = input.snapshot.columns[sourceIndex];
		if (!KUSTO_SCALAR_TYPES.includes(column.type as KustoScalarType)) {
			throw new Error(`“${column.type}” is not a supported Kusto scalar type.`);
		}
		return { name: column.name, type: column.type as KustoScalarType };
	});

	const nextColumns = input.orderedSourceIndexes.map((sourceIndex) => ({
		sourceIndex,
		...input.snapshot.columns[sourceIndex]
	}));
	const diff = diffTableSchema(input.snapshot.columns, nextColumns);
	if (!diff.counts.reordered) throw new Error('Change the column order before reviewing.');

	const schema = columns.map(formatColumn).join(', ');
	const preservedDocstring = input.snapshot.docstring;
	const preservedFolder = input.snapshot.folder ?? '';
	const command = `.alter table ${tableName} (${schema}) with (docstring = ${quoteKustoString(preservedDocstring)}, folder = ${quoteKustoString(preservedFolder)})`;

	return {
		kind: 'reorder-table-columns',
		command,
		columns,
		diff,
		preservedDocstring,
		preservedFolder,
		risk: 'destructive',
		summary: `${diff.counts.reordered} ${diff.counts.reordered === 1 ? 'column' : 'columns'} reordered`
	};
}
