import { describe, expect, it } from 'vitest';

import type { QueryResult } from '$lib/types/query-result';
import {
	buildChangeColumnTypePlan,
	buildCreateTablePlan,
	buildDropColumnPlan,
	buildDropTableCommand,
	buildEditColumnPlan,
	buildTableMutationPlan,
	buildTablePreflightCommands,
	compareTableSnapshots,
	formatPlanCommands,
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
		{ name: 'Timestamp', type: 'datetime', docstring: '' },
		{ name: 'Value', type: 'real', docstring: '' }
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
				".create table ['Today\\'s Events'] (Timestamp:datetime, ['Trace Id']:guid) with (docstring = 'Today\\'s telemetry', folder = 'Operations')",
			columnDocstringsCommand:
				".alter table ['Today\\'s Events'] column-docstrings (Timestamp:'', ['Trace Id']:'Correlation identifier')",
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
			".alter-merge table ['Today\\'s Metrics'] (Timestamp:datetime) with (docstring = 'Today\\'s telemetry')"
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

	it('sets new columns’ descriptions in a second command that keeps the other descriptions', () => {
		const plan = buildTableMutationPlan({
			tableName: "Today's Metrics",
			nextDocstring: '',
			existingColumnNames: ['Timestamp'],
			newColumns: [
				{ name: 'Region', type: 'string', docstring: ` Where it's "from" ` },
				{ name: 'Count', type: 'long', docstring: '  ' }
			]
		});

		expect(plan).toMatchObject({
			command: ".alter-merge table ['Today\\'s Metrics'] (Region:string, Count:long)",
			columnDocstringsCommand: `.alter-merge table ['Today\\'s Metrics'] column-docstrings (Region:'Where it\\'s "from"')`,
			addedColumns: [
				{ name: 'Region', type: 'string', docstring: `Where it's "from"` },
				{ name: 'Count', type: 'long' }
			]
		});
	});

	it('adds columns without a descriptions command when none has a description', () => {
		const plan = buildTableMutationPlan({
			tableName: 'Metrics',
			nextDocstring: '',
			existingColumnNames: ['Timestamp'],
			newColumns: [{ name: 'Region', type: 'string' }]
		});

		expect(plan).not.toHaveProperty('columnDocstringsCommand');
	});

	it('previews a plan’s commands in the order they run', () => {
		const descriptionOnly = buildTableMutationPlan({
			tableName: 'Metrics',
			currentDocstring: 'Old',
			nextDocstring: 'New',
			existingColumnNames: ['Timestamp'],
			newColumns: []
		});
		const withDescriptions = buildTableMutationPlan({
			tableName: 'Metrics',
			nextDocstring: '',
			existingColumnNames: ['Timestamp'],
			newColumns: [{ name: 'Region', type: 'string', docstring: 'Where' }]
		});

		expect(formatPlanCommands(descriptionOnly)).toBe(".alter table Metrics docstring 'New'");
		expect(formatPlanCommands(withDescriptions)).toBe(
			".alter-merge table Metrics (Region:string)\n.alter-merge table Metrics column-docstrings (Region:'Where')"
		);
	});

	describe('editing a column', () => {
		const edit = (input: {
			columnName?: string;
			currentDocstring?: string;
			newColumnName?: string;
			nextDocstring?: string;
		}) =>
			buildEditColumnPlan({
				tableName: "Today's Metrics",
				columnName: input.columnName ?? 'Trace Id',
				currentDocstring: input.currentDocstring,
				newColumnName: input.newColumnName ?? input.columnName ?? 'Trace Id',
				nextDocstring: input.nextDocstring ?? input.currentDocstring ?? '',
				existingColumnNames: ['Timestamp', 'Trace Id']
			});

		it('renames a column as a breaking change', () => {
			expect(edit({ newColumnName: 'Correlation Id' })).toEqual({
				kind: 'edit-column',
				command: ".rename column ['Today\\'s Metrics'].['Trace Id'] to ['Correlation Id']",
				columnName: 'Trace Id',
				newColumnName: 'Correlation Id',
				renames: true,
				updatesDocstring: false,
				nextDocstring: '',
				risk: 'destructive',
				summary: 'Trace Id renamed to Correlation Id'
			});
		});

		it('changes only the description as a safe change that keeps other descriptions', () => {
			expect(edit({ currentDocstring: 'Old', nextDocstring: ` Request's id ` })).toEqual({
				kind: 'edit-column',
				command:
					".alter-merge table ['Today\\'s Metrics'] column-docstrings (['Trace Id']:'Request\\'s id')",
				columnName: 'Trace Id',
				newColumnName: 'Trace Id',
				renames: false,
				updatesDocstring: true,
				nextDocstring: "Request's id",
				risk: 'safe',
				summary: 'Trace Id description updated'
			});
		});

		it('clears a description with an empty docstring', () => {
			expect(edit({ currentDocstring: 'Old', nextDocstring: '  ' }).command).toBe(
				".alter-merge table ['Today\\'s Metrics'] column-docstrings (['Trace Id']:'')"
			);
		});

		it('renames first, then sets the description under the new name', () => {
			const plan = edit({
				currentDocstring: 'Old',
				newColumnName: 'Correlation Id',
				nextDocstring: 'New'
			});

			expect(plan).toMatchObject({
				command: ".rename column ['Today\\'s Metrics'].['Trace Id'] to ['Correlation Id']",
				columnDocstringsCommand:
					".alter-merge table ['Today\\'s Metrics'] column-docstrings (['Correlation Id']:'New')",
				risk: 'destructive',
				summary: 'Trace Id renamed to Correlation Id · Correlation Id description updated'
			});
		});

		it('rejects a missing column, a taken or blank name, a case-only rename, and no change', () => {
			expect(() => edit({ columnName: 'Missing', newColumnName: 'Reading' })).toThrow(
				'no longer in the table'
			);
			expect(() => edit({ newColumnName: 'timestamp' })).toThrow('already exists');
			expect(() => edit({ newColumnName: '  ' })).toThrow('Enter a column name');
			expect(() => edit({ newColumnName: ' trace id ' })).toThrow('case-insensitive');
			expect(() => edit({ currentDocstring: 'Same', nextDocstring: ' Same ' })).toThrow(
				'Change the name or description'
			);
		});
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
			command: ".alter column ['Today\\'s Metrics'].['Trace Id'] type=guid",
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
});

describe('table mutation preflight', () => {
	it('builds quoted JSON-schema, CSL-schema, and details commands', () => {
		expect(buildTablePreflightCommands("Today's Metrics")).toEqual([
			".show table ['Today\\'s Metrics'] schema as json",
			".show table ['Today\\'s Metrics'] cslschema",
			".show table ['Today\\'s Metrics'] details"
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

	it('reads column descriptions from a real Kustainer schema, treating empty and missing alike', () => {
		// `.show table KiteDocstringTest schema as json` from Kustainer after A's description was
		// cleared: A has "", B has a description, and C never had one.
		const schema =
			'{"Name":"KiteDocstringTest","DocString":"Table description","OrderedColumns":[{"Name":"A","Type":"System.String","CslType":"string","DocString":""},{"Name":"B","Type":"System.String","CslType":"string","DocString":"Column B"},{"Name":"C","Type":"System.String","CslType":"string"}]}';
		const snapshot = parseTablePreflightResults([
			result(
				['TableName', 'Schema', 'DatabaseName'],
				['KiteDocstringTest', schema, 'NetDefaultDB']
			),
			result(['Schema'], ['A:string,B:string,C:string']),
			result(['TableId', 'TotalRowCount'], ['table-1', 0])
		]);

		expect(snapshot.columns).toEqual([
			{ name: 'A', type: 'string', docstring: '' },
			{ name: 'B', type: 'string', docstring: 'Column B' },
			{ name: 'C', type: 'string', docstring: '' }
		]);
		expect(
			compareTableSnapshots(
				snapshotLoadedTable('NetDefaultDB', {
					name: 'KiteDocstringTest',
					docstring: 'Table description',
					columns: [
						{ name: 'A', type: 'string', docstring: '' },
						{ name: 'B', type: 'string', docstring: 'Column B' },
						{ name: 'C', type: 'string' }
					]
				}),
				snapshot
			)
		).toEqual([]);
	});

	it('reports a column description changed by another client', () => {
		const changed: TableSchemaSnapshot = {
			...currentPreflight,
			columns: [
				{ name: 'Timestamp', type: 'datetime', docstring: '' },
				{ name: 'Value', type: 'real', docstring: 'Set elsewhere' }
			]
		};

		expect(compareTableSnapshots(currentPreflight, changed)).toEqual([
			{ kind: 'column-docstring', message: 'The description of column Value changed.' }
		]);
	});

	it('detects table recreation and concurrent schema or metadata changes', () => {
		const changed: TableSchemaSnapshot = {
			...currentPreflight,
			tableId: 'table-id-2',
			columns: [
				{ name: 'Timestamp', type: 'datetime', docstring: '' },
				{ name: 'Reading', type: 'long', docstring: '' }
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
