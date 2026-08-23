import { describe, expect, it } from 'vitest';

import type { QueryResult } from '$lib/types/query-result';
import {
	buildChangeColumnTypePlan,
	buildCreateTablePlan,
	buildDropColumnPlan,
	buildDropTableCommand,
	buildRenameColumnPlan,
	buildReorderTableColumnsPlan,
	buildTableMutationPlan,
	buildTablePreflightCommands,
	compareTableSnapshots,
	diffTableSchema,
	parseTablePreflightResults,
	snapshotLoadedTable,
	type TableSchemaSnapshot
} from './table-management';

function result(columns: string[], row: unknown[]): QueryResult {
	return {
		columns: columns.map((name) => ({ name, type: 'string' })),
		rows: [row],
		totalRowCount: 1,
		renderedRowCount: 1,
		warnings: [],
		elapsedMs: 1,
		clientRequestId: 'Kite.Admin.Preflight;test'
	};
}

const currentPreflight: TableSchemaSnapshot = {
	databaseName: 'NetDefaultDB',
	tableName: 'Metrics',
	columns: [
		{ name: 'Timestamp', type: 'datetime' },
		{ name: 'Value', type: 'real' }
	],
	docstring: 'Telemetry.',
	folder: 'Operations',
	cslSchema: 'Timestamp:datetime,Value:real',
	tableId: 'table-id-1',
	totalRowCount: 42
};

describe('table management commands', () => {
	it('quotes table names in drop commands', () => {
		expect(buildDropTableCommand('Event Logs')).toBe(".drop table ['Event Logs']");
		expect(() => buildDropTableCommand('')).toThrow('Select a target table.');
	});

	it('builds a quoted table creation with columns and metadata', () => {
		expect(
			buildCreateTablePlan({
				tableName: "Today's Events",
				existingTableNames: ['Metrics'],
				columns: [
					{ name: 'Timestamp', type: 'datetime' },
					{ name: 'Trace Id', type: 'guid', docstring: 'Correlation identifier' }
				],
				docstring: "Today's telemetry",
				folder: 'Operations'
			})
		).toEqual({
			kind: 'create-table',
			command:
				".create table ['Today''s Events'] (Timestamp:datetime, ['Trace Id']:guid) with (docstring = 'Today''s telemetry', folder = 'Operations')",
			tableName: "Today's Events",
			columns: [
				{ name: 'Timestamp', type: 'datetime' },
				{ name: 'Trace Id', type: 'guid', docstring: 'Correlation identifier' }
			],
			docstring: "Today's telemetry",
			folder: 'Operations',
			risk: 'safe',
			summary: 'created with 2 columns'
		});
	});

	it('rejects invalid table creation drafts', () => {
		const build = (
			tableName: string,
			columns: Parameters<typeof buildCreateTablePlan>[0]['columns']
		) =>
			buildCreateTablePlan({
				tableName,
				existingTableNames: ['Metrics'],
				columns
			});

		expect(() => build('', [{ name: 'Value', type: 'long' }])).toThrow('table name');
		expect(() => build('metrics', [{ name: 'Value', type: 'long' }])).toThrow('already exists');
		expect(() => build('Events', [])).toThrow('at least one column');
		expect(() =>
			build('Events', [
				{ name: 'Value', type: 'long' },
				{ name: 'value', type: 'string' }
			])
		).toThrow('must be unique');
		expect(() =>
			build('Events', [{ name: 'Value', type: 'string); .drop table Metrics' as 'string' }])
		).toThrow('not a supported Kusto scalar type');
	});

	it('builds an additive schema update without repeating existing columns', () => {
		expect(
			buildTableMutationPlan({
				tableName: 'Metrics',
				currentDocstring: 'Telemetry.',
				nextDocstring: 'Telemetry.',
				existingColumnNames: ['Timestamp'],
				newColumns: [
					{ name: 'Value', type: 'real' },
					{ name: 'Trace Id', type: 'guid' }
				]
			})
		).toEqual({
			kind: 'update-table',
			command: ".alter-merge table Metrics (Value:real, ['Trace Id']:guid)",
			addedColumns: [
				{ name: 'Value', type: 'real' },
				{ name: 'Trace Id', type: 'guid' }
			],
			updatesDocstring: false,
			nextDocstring: 'Telemetry.',
			risk: 'safe',
			summary: '2 columns added'
		});
	});

	it('combines additive columns and an escaped docstring in one command', () => {
		const plan = buildTableMutationPlan({
			tableName: "Today's Metrics",
			currentDocstring: '',
			nextDocstring: "Today's telemetry",
			existingColumnNames: [],
			newColumns: [{ name: 'Timestamp', type: 'datetime' }]
		});

		expect(plan.command).toBe(
			".alter-merge table ['Today''s Metrics'] (Timestamp:datetime) with (docstring = 'Today''s telemetry')"
		);
		expect(plan.summary).toBe('1 column added · description updated');
	});

	it('builds a description-only update and supports clearing it', () => {
		expect(
			buildTableMutationPlan({
				tableName: 'Metrics',
				currentDocstring: 'Old description',
				nextDocstring: '',
				existingColumnNames: ['Timestamp'],
				newColumns: []
			}).command
		).toBe(".alter table Metrics docstring ''");
	});

	it('rejects no-op drafts', () => {
		expect(() =>
			buildTableMutationPlan({
				tableName: 'Metrics',
				currentDocstring: 'Telemetry.',
				nextDocstring: ' Telemetry. ',
				existingColumnNames: ['Timestamp'],
				newColumns: []
			})
		).toThrow('Change the description or add at least one column');
	});

	it('rejects blank and duplicate new columns', () => {
		expect(() =>
			buildTableMutationPlan({
				tableName: 'Metrics',
				nextDocstring: '',
				existingColumnNames: ['Timestamp'],
				newColumns: [{ name: ' ', type: 'string' }]
			})
		).toThrow('Enter a name');

		expect(() =>
			buildTableMutationPlan({
				tableName: 'Metrics',
				nextDocstring: '',
				existingColumnNames: ['Timestamp'],
				newColumns: [{ name: 'timestamp', type: 'datetime' }]
			})
		).toThrow('must be unique');
	});

	it('rejects unsupported types even when called outside the typed UI', () => {
		expect(() =>
			buildTableMutationPlan({
				tableName: 'Metrics',
				nextDocstring: '',
				existingColumnNames: [],
				newColumns: [{ name: 'Payload', type: 'string); .drop table Metrics' as 'string' }]
			})
		).toThrow('not a supported Kusto scalar type');
	});

	it('builds a quoted single-column rename', () => {
		expect(
			buildRenameColumnPlan({
				tableName: "Today's Metrics",
				columnName: 'Trace Id',
				newColumnName: 'Correlation Id',
				existingColumnNames: ['Timestamp', 'Trace Id']
			})
		).toEqual({
			kind: 'rename-column',
			command: ".rename column ['Today''s Metrics'].['Trace Id'] to ['Correlation Id']",
			columnName: 'Trace Id',
			newColumnName: 'Correlation Id',
			risk: 'destructive',
			summary: 'Trace Id renamed to Correlation Id'
		});
	});

	it('rejects missing, duplicate, and no-op rename targets', () => {
		const rename = (columnName: string, newColumnName: string) =>
			buildRenameColumnPlan({
				tableName: 'Metrics',
				columnName,
				newColumnName,
				existingColumnNames: ['Timestamp', 'Value']
			});

		expect(() => rename('Missing', 'Reading')).toThrow('no longer in the table');
		expect(() => rename('Value', 'timestamp')).toThrow('already exists');
		expect(() => rename('Value', ' value ')).toThrow('different column name');
	});

	it('builds an irreversible drop without masking a stale target', () => {
		expect(
			buildDropColumnPlan({
				tableName: 'Metrics',
				columnName: 'Value',
				existingColumnNames: ['Timestamp', 'Value']
			})
		).toEqual({
			kind: 'drop-column',
			command: '.drop column Metrics.Value',
			columnName: 'Value',
			risk: 'irreversible',
			summary: 'Value removed'
		});
	});

	it('rejects a missing drop target and removal of the last column', () => {
		expect(() =>
			buildDropColumnPlan({
				tableName: 'Metrics',
				columnName: 'Missing',
				existingColumnNames: ['Value']
			})
		).toThrow('no longer in the table');

		expect(() =>
			buildDropColumnPlan({
				tableName: 'Metrics',
				columnName: 'Value',
				existingColumnNames: ['Value']
			})
		).toThrow('last column');
	});

	it('builds a quoted irreversible direct column type change', () => {
		expect(
			buildChangeColumnTypePlan({
				tableName: "Today's Metrics",
				columnName: 'Trace Id',
				currentColumnType: 'string',
				newColumnType: 'guid',
				existingColumnNames: ['Timestamp', 'Trace Id']
			})
		).toEqual({
			kind: 'change-column-type',
			command: ".alter column ['Today''s Metrics'].['Trace Id'] type=guid",
			columnName: 'Trace Id',
			currentColumnType: 'string',
			newColumnType: 'guid',
			risk: 'irreversible',
			summary: 'Trace Id changed from string to guid'
		});
	});

	it('rejects missing, unsupported, and unchanged column type changes', () => {
		const changeType = (columnName: string, newColumnType: string) =>
			buildChangeColumnTypePlan({
				tableName: 'Metrics',
				columnName,
				currentColumnType: 'real',
				newColumnType,
				existingColumnNames: ['Timestamp', 'Value']
			});

		expect(() => changeType('Missing', 'long')).toThrow('no longer in the table');
		expect(() => changeType('Value', 'real')).toThrow('different column type');
		expect(() => changeType('Value', 'string); .drop table Metrics')).toThrow(
			'supported new column type'
		);
	});

	it('computes added, removed, reordered, renamed, and type-changed schema rows', () => {
		const diff = diffTableSchema(currentPreflight.columns, [
			{ sourceIndex: 1, name: 'Reading', type: 'long' },
			{ name: 'Source', type: 'string' }
		]);

		expect(diff.counts).toEqual({
			added: 1,
			removed: 1,
			reordered: 0,
			renamed: 1,
			'type-changed': 1
		});
		expect(diff.rows).toEqual([
			{
				sourceIndex: 0,
				before: { name: 'Timestamp', type: 'datetime', index: 0 },
				changes: ['removed']
			},
			{
				sourceIndex: 1,
				before: { name: 'Value', type: 'real', index: 1 },
				after: { name: 'Reading', type: 'long', index: 0 },
				changes: ['renamed', 'type-changed']
			},
			{
				after: { name: 'Source', type: 'string', index: 1 },
				changes: ['added']
			}
		]);
	});

	it('detects relative reordering without treating shifts from removal as reorders', () => {
		expect(
			diffTableSchema(currentPreflight.columns, [{ sourceIndex: 1, name: 'Value', type: 'real' }])
				.counts.reordered
		).toBe(0);

		expect(
			diffTableSchema(currentPreflight.columns, [
				{ sourceIndex: 1, name: 'Value', type: 'real' },
				{ sourceIndex: 0, name: 'Timestamp', type: 'datetime' }
			]).counts.reordered
		).toBe(2);
	});

	it('builds one complete reorder command while preserving metadata', () => {
		const plan = buildReorderTableColumnsPlan({
			snapshot: currentPreflight,
			orderedSourceIndexes: [1, 0]
		});

		expect(plan).toMatchObject({
			kind: 'reorder-table-columns',
			command:
				".alter table Metrics (Value:real, Timestamp:datetime) with (docstring = 'Telemetry.', folder = 'Operations')",
			columns: [
				{ name: 'Value', type: 'real' },
				{ name: 'Timestamp', type: 'datetime' }
			],
			preservedDocstring: 'Telemetry.',
			preservedFolder: 'Operations',
			risk: 'destructive',
			summary: '2 columns reordered'
		});
		expect(plan.diff.counts).toEqual({
			added: 0,
			removed: 0,
			reordered: 2,
			renamed: 0,
			'type-changed': 0
		});
	});

	it('rejects incomplete, duplicate, unknown, and unchanged reorder permutations', () => {
		const build = (orderedSourceIndexes: readonly number[]) =>
			buildReorderTableColumnsPlan({ snapshot: currentPreflight, orderedSourceIndexes });

		expect(() => build([0])).toThrow('every verified column exactly once');
		expect(() => build([0, 0])).toThrow('every verified column exactly once');
		expect(() => build([0, 2])).toThrow('every verified column exactly once');
		expect(() => build([0, 1])).toThrow('Change the column order');
	});
});

describe('table mutation preflight', () => {
	it('builds quoted JSON-schema, CSL-schema, and details commands', () => {
		expect(buildTablePreflightCommands("Today's Metrics")).toEqual([
			".show table ['Today''s Metrics'] schema as json",
			".show table ['Today''s Metrics'] cslschema",
			".show table ['Today''s Metrics'] details"
		]);
	});

	it('parses the ordered schema and preservation metadata', () => {
		const snapshot = parseTablePreflightResults([
			result(
				['TableName', 'Schema', 'DatabaseName', 'Folder', 'DocString'],
				[
					'Metrics',
					JSON.stringify({
						Name: 'Metrics',
						DocString: 'Telemetry.',
						OrderedColumns: [
							{ Name: 'Timestamp', Type: 'System.DateTime', CslType: 'datetime' },
							{ Name: 'Value', Type: 'System.Double', CslType: 'real' }
						]
					}),
					'NetDefaultDB',
					'Operations',
					'Telemetry.'
				]
			),
			result(
				['TableName', 'Schema', 'DatabaseName', 'Folder', 'DocString'],
				['Metrics', 'Timestamp:datetime,Value:real', 'NetDefaultDB', 'Operations', 'Telemetry.']
			),
			result(
				['TableName', 'DatabaseName', 'Folder', 'DocString', 'TotalRowCount', 'TableId'],
				['Metrics', 'NetDefaultDB', 'Operations', 'Telemetry.', 42, 'table-id-1']
			)
		]);

		expect(snapshot).toEqual(currentPreflight);
	});

	it('accepts a fresh preflight that matches the schema loaded into the editor', () => {
		const loaded = snapshotLoadedTable('NetDefaultDB', {
			name: 'Metrics',
			docstring: 'Telemetry.',
			columns: [
				{ name: 'Timestamp', type: 'datetime' },
				{ name: 'Value', type: 'real' }
			]
		});

		expect(compareTableSnapshots(loaded, currentPreflight)).toEqual([]);
	});

	it('detects table recreation and concurrent schema or metadata changes', () => {
		const changed: TableSchemaSnapshot = {
			...currentPreflight,
			tableId: 'table-id-2',
			columns: [
				{ name: 'Timestamp', type: 'datetime' },
				{ name: 'Reading', type: 'long' }
			],
			docstring: 'Changed elsewhere.',
			folder: 'New folder',
			cslSchema: 'Timestamp:datetime,Reading:long'
		};

		expect(compareTableSnapshots(currentPreflight, changed)).toEqual([
			{ kind: 'table-recreated', message: 'The table was dropped and recreated.' },
			{
				kind: 'column',
				message: 'Column 2 changed from Value:real to Reading:long.'
			},
			{ kind: 'docstring', message: 'The table description changed.' },
			{ kind: 'folder', message: 'The table folder changed.' },
			{ kind: 'csl-schema', message: 'The CSL schema changed.' }
		]);
	});

	it('rejects incomplete preflight responses', () => {
		expect(() => parseTablePreflightResults([])).toThrow('incomplete table preflight');
	});
});
