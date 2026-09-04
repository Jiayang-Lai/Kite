import { describe, expect, it } from 'vitest';

import type { InlineCsvPlan } from '$lib/kusto/inline-file';
import {
	detectLocalFileFormat,
	getInlineFileStatusLabel,
	getTargetColumnShapeWarnings,
	prepareIngestionCommand,
	resolveIngestionSourceLocations
} from './data-ingestion-workspace';

const baseOptions = {
	sourceMode: 'inline' as const,
	isEmulatedCluster: false,
	ingestion: {
		mode: 'kustainer' as const,
		containerRoot: '/data',
		maxInlineCommandBytes: 1000,
		maxInlineFileBytes: 1000
	},
	selectedTable: 'Events',
	inlineData: '1,hello',
	inlineDataPayload: '1,hello',
	inlineFile: undefined,
	localFileFormat: undefined,
	remoteFileUrl: '',
	remoteFileFormat: 'csv' as const,
	remoteFileSkipFirstLine: false,
	relativePath: 'events.parquet',
	fileFormat: 'parquet' as const
};

describe('data ingestion workspace model', () => {
	it('detects supported local file formats case-insensitively', () => {
		expect(detectLocalFileFormat({ name: 'events.CSV' })).toBe('csv');
		expect(detectLocalFileFormat({ name: 'events.parquet' })).toBe('parquet');
		expect(detectLocalFileFormat({ name: 'events.json' })).toBeUndefined();
	});

	it('builds Kusto commands for each command-backed source', () => {
		expect(prepareIngestionCommand(baseOptions).command).toContain(
			'.ingest inline into table Events'
		);
		expect(prepareIngestionCommand({ ...baseOptions, sourceMode: 'file' }).command).toContain(
			'@"/data/events.parquet"'
		);
		expect(
			prepareIngestionCommand({
				...baseOptions,
				sourceMode: 'remote-file',
				remoteFileUrl: 'https://example.com/events.csv',
				remoteFileSkipFirstLine: true
			}).command
		).toContain('ignoreFirstRecord=true');
	});

	it('validates emulated sources without throwing through the view model', () => {
		expect(
			prepareIngestionCommand({
				...baseOptions,
				isEmulatedCluster: true,
				inlineData: ' '
			})
		).toEqual({ command: '', error: 'Enter at least one CSV row to ingest.' });
		expect(
			prepareIngestionCommand({
				...baseOptions,
				sourceMode: 'inline-file',
				isEmulatedCluster: true,
				inlineFile: new File(['row'], 'events.csv'),
				localFileFormat: 'csv'
			})
		).toEqual({ command: 'DuckDB append from local CSV file', error: '' });
	});

	it('returns safe source descriptions while command validation owns errors', () => {
		expect(
			resolveIngestionSourceLocations({
				ingestion: baseOptions.ingestion,
				relativePath: 'folder/events.csv',
				remoteFileUrl: 'https://example.com/events.csv?token=secret',
				isEmulatedCluster: true
			})
		).toEqual({
			mountedFilePath: '/data/folder/events.csv',
			remoteFileUrl: 'https://example.com/events.csv?…'
		});
		expect(
			resolveIngestionSourceLocations({
				ingestion: baseOptions.ingestion,
				relativePath: '../escape.csv',
				remoteFileUrl: 'invalid',
				isEmulatedCluster: false
			})
		).toEqual({ mountedFilePath: '', remoteFileUrl: '' });
	});

	it('maps CSV positions and headers to target column warnings', () => {
		const plan = {
			columnCount: 2,
			headerColumns: ['EventId', 'WrongName']
		} as InlineCsvPlan;
		const warnings = getTargetColumnShapeWarnings(plan, [
			{ name: 'EventId' },
			{ name: 'Message' },
			{ name: 'Timestamp' }
		] as never);

		expect(warnings).toEqual([
			undefined,
			{ kind: 'header-order', message: 'Source header: WrongName' },
			{ kind: 'missing-source-column', message: 'No source column at position 3.' }
		]);
	});

	it('provides presentation labels without embedding the mapping in the component', () => {
		expect(getInlineFileStatusLabel('succeeded')).toBe('Complete');
		expect(getInlineFileStatusLabel('idle')).toBe('Ready');
	});
});
