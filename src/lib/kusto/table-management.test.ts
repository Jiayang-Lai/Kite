import { describe, expect, it } from 'vitest';

import type { QueryResult } from '$lib/types/query-result';
import {
	buildDropColumnPlan,
	buildRenameColumnPlan,
	buildTableMutationPlan,
	buildTablePreflightCommands,
	compareTableSnapshots,
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
