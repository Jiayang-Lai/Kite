import { flushSync } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

const adapterMocks = vi.hoisted(() => ({
	startIngestion: vi.fn(),
	startKustoManagementCommand: vi.fn()
}));

vi.mock('$lib/admin/ingestion-adapter', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/admin/ingestion-adapter')>()),
	startIngestion: adapterMocks.startIngestion
}));

vi.mock('$lib/kusto/query-client', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/kusto/query-client')>()),
	startKustoManagementCommand: adapterMocks.startKustoManagementCommand
}));

import { OperationCancelledError, type QueryResult } from '$lib/types/query-result';
import {
	createDataIngestionController,
	type DataIngestionController,
	type DataIngestionTarget
} from './data-ingestion-controller.svelte';

const databases = {
	Analytics: {
		name: 'Analytics',
		tables: [{ name: 'Events', columns: [{ name: 'Message', type: 'string' }] }]
	}
};

const kustainerTarget: DataIngestionTarget = {
	databases,
	selectedDatabase: 'Analytics',
	selectedTable: 'Events',
	clusterId: 'local',
	clusterUrl: 'http://localhost:8080',
	ingestion: {
		mode: 'kustainer',
		containerRoot: '/kustodata/raw',
		maxInlineFileBytes: 1024 * 1024,
		maxInlineCommandBytes: 64 * 1024
	},
	isEmulatedCluster: false
};

const emulatedTarget: DataIngestionTarget = {
	...kustainerTarget,
	clusterId: 'emulated',
	clusterUrl: 'emulated://kite',
	ingestion: undefined,
	isEmulatedCluster: true
};

const ingestedResult: QueryResult = {
	columns: [{ name: 'RowsInserted', type: 'long' }],
	rows: [[1]],
	totalRowCount: 1,
	renderedRowCount: 1,
	warnings: [],
	elapsedMs: 1,
	clientRequestId: 'Kite.Test;1'
};

let cleanup: (() => void) | undefined;

function createController(initialTarget: DataIngestionTarget) {
	const target = $state(initialTarget);
	let controller!: DataIngestionController;
	cleanup = $effect.root(() => {
		controller = createDataIngestionController(() => target);
	});
	return { controller, target };
}

function selectFile(controller: DataIngestionController, file: File) {
	controller.form.selectedFiles = { 0: file, length: 1 } as unknown as FileList;
	controller.selectInlineFile();
}

function confirm(controller: DataIngestionController) {
	controller.requestIngestion();
	controller.form.confirmationText = 'RUN';
	controller.confirmIngestion();
}

afterEach(() => {
	cleanup?.();
	cleanup = undefined;
	vi.clearAllMocks();
});

describe('data ingestion controller', () => {
	it('scans inline CSV, requires confirmation, and runs a Kustainer command', async () => {
		adapterMocks.startIngestion.mockReturnValue({
			promise: Promise.resolve(ingestedResult),
			cancel: vi.fn()
		});
		const { controller } = createController(kustainerTarget);
		expect(controller.canIngest).toBe(false);

		controller.form.inlineData = 'hello';
		await vi.waitFor(() => expect(controller.canIngest).toBe(true));
		controller.requestIngestion();
		expect(controller.form.showConfirmation).toBe(true);
		expect(controller.pendingCommand).toContain('.ingest inline into table Events');

		controller.confirmIngestion();
		expect(adapterMocks.startIngestion).not.toHaveBeenCalled();
		controller.form.confirmationText = 'RUN';
		controller.confirmIngestion();

		await vi.waitFor(() => expect(controller.result).toEqual(ingestedResult));
		expect(adapterMocks.startIngestion).toHaveBeenCalledWith({
			kind: 'kustainer',
			database: 'Analytics',
			command: controller.pendingCommand,
			clusterUrl: 'http://localhost:8080'
		});
		expect(controller.form.showConfirmation).toBe(false);
	});

	it('reports a cancelled emulated local-file ingestion as cancelled and rolled back', async () => {
		adapterMocks.startIngestion.mockImplementation(() => ({
			promise: Promise.reject(new OperationCancelledError('Query cancelled.')),
			cancel: vi.fn()
		}));
		const { controller } = createController(emulatedTarget);
		controller.form.sourceMode = 'inline-file';
		controller.form.selectedFiles = {
			0: new File(['parquet'], 'events.parquet'),
			length: 1
		} as unknown as FileList;
		controller.selectInlineFile();
		await vi.waitFor(() => expect(controller.canIngest).toBe(true));

		controller.requestIngestion();
		controller.form.confirmationText = 'RUN';
		controller.confirmIngestion();

		await vi.waitFor(() => expect(controller.inlineFileState).toBe('cancelled'));
		expect(controller.ingestionError).toContain('DuckDB rolled back');
		expect(adapterMocks.startIngestion.mock.calls[0][0]).toMatchObject({
			kind: 'emulated',
			request: { clusterId: 'emulated', format: 'parquet', source: { kind: 'file' } }
		});
	});

	it('leaves mounted-file mode when the target becomes an emulated cluster', async () => {
		const { controller, target } = createController(kustainerTarget);
		controller.form.sourceMode = 'file';

		target.isEmulatedCluster = true;
		await vi.waitFor(() => expect(controller.form.sourceMode).toBe('inline'));
	});

	it('ingests a CSV file in sequential Kustainer inline chunks', async () => {
		adapterMocks.startKustoManagementCommand.mockImplementation(() => ({
			promise: Promise.resolve({
				...ingestedResult,
				columns: [{ name: 'ExtentId', type: 'guid' }],
				rows: [['extent-1']]
			}),
			cancel: vi.fn()
		}));
		const { controller } = createController(kustainerTarget);
		controller.form.sourceMode = 'inline-file';
		expect(controller.hasSourceInput).toBe(false);
		expect(controller.confirmationSource).toBe('Inline CSV file');

		selectFile(controller, new File(['Message\nhello\nworld\n'], 'events.csv'));
		await vi.waitFor(() => expect(controller.inlineFileState).toBe('ready'));
		expect(controller.hasSourceInput).toBe(true);
		expect(controller.localFileFormat).toBe('csv');
		expect(controller.inlineFilePlan?.totalRecords).toBe(2);
		expect(controller.inlineFileScanProgress).toBe(100);
		expect(controller.inlineFileStatusLabel).toBeTruthy();
		expect(controller.confirmationSource).toMatch(/^events\.csv · 2 rows · \d+ chunks$/);
		expect(controller.canIngest).toBe(true);

		confirm(controller);
		expect(controller.pendingCommand).toContain('sequential .ingest inline commands');
		await vi.waitFor(() => expect(controller.inlineFileState).toBe('succeeded'));
		expect(controller.completedFileRecords).toBe(2);
		expect(controller.completedFileChunks).toBe(controller.inlineFilePlan?.chunks.length);
		expect(controller.fileExecutionProgress).toBe(100);
		expect(controller.activeFileChunk).toBeUndefined();
		expect(controller.ingestionError).toBe('');
		expect(controller.result).toBeDefined();
		expect(adapterMocks.startKustoManagementCommand).toHaveBeenCalledWith(
			'Analytics',
			expect.stringContaining('.ingest inline into table Events'),
			'http://localhost:8080'
		);
	});

	it('marks a Kustainer inline-file ingestion as failed when no chunk completes', async () => {
		adapterMocks.startKustoManagementCommand.mockImplementation(() => ({
			promise: Promise.reject(new Error('Ingestion refused.')),
			cancel: vi.fn()
		}));
		const { controller } = createController(kustainerTarget);
		controller.form.sourceMode = 'inline-file';
		selectFile(controller, new File(['Message\nhello\n'], 'events.csv'));
		await vi.waitFor(() => expect(controller.canIngest).toBe(true));

		confirm(controller);
		await vi.waitFor(() => expect(controller.inlineFileState).toBe('failed'));
		expect(controller.ingestionError).toContain('Ingestion refused.');
		expect(controller.inlineFileError).toBe(controller.ingestionError);
		expect(controller.isRunning).toBe(false);
	});

	it('reports a rejected local file and rescans it after the header setting changes', async () => {
		const { controller } = createController(kustainerTarget);
		controller.form.sourceMode = 'inline-file';
		controller.rescanInlineFile();
		expect(controller.inlineFileState).toBe('idle');

		selectFile(controller, new File(['parquet'], 'events.parquet'));
		await vi.waitFor(() => expect(controller.inlineFileState).toBe('failed'));
		expect(controller.inlineFileError).toContain('accepts uncompressed .csv files only');
		expect(controller.canIngest).toBe(false);

		selectFile(controller, new File([''], 'empty.csv'));
		await vi.waitFor(() => expect(controller.inlineFileError).toBe('The selected file is empty.'));
		controller.rescanInlineFile();
		await vi.waitFor(() => expect(controller.inlineFileState).toBe('failed'));
		expect(controller.confirmationSource).toBe('empty.csv · 0 B');
	});

	it('explains why an incomplete request cannot be reviewed', () => {
		const { controller } = createController(kustainerTarget);
		controller.form.sourceMode = 'remote-file';
		expect(controller.hasSourceInput).toBe(false);
		controller.requestIngestion();
		expect(controller.form.showConfirmation).toBe(false);
		expect(controller.ingestionError).toBe(controller.preparedCommand.error);

		controller.form.sourceMode = 'file';
		controller.form.relativePath = 'events.parquet';
		expect(controller.hasSourceInput).toBe(true);
		expect(controller.sourceShapeCheckUnavailable).toBe(true);
		expect(controller.confirmationSource).toBe(controller.resolvedFilePath);
		expect(controller.activeCsvPlan).toBeUndefined();
		expect(controller.activeGuardrails).toEqual([]);
		expect(controller.extraSourceColumnCount).toBe(0);
	});

	it('runs a mounted-file Kustainer command and reports adapter errors', async () => {
		adapterMocks.startIngestion.mockReturnValue({
			promise: Promise.reject(new Error('File not found.')),
			cancel: vi.fn()
		});
		const { controller } = createController(kustainerTarget);
		controller.form.sourceMode = 'file';
		controller.form.relativePath = 'events.parquet';
		expect(controller.canIngest).toBe(true);

		confirm(controller);
		expect(controller.pendingCommand).toBe(controller.preparedCommand.command);
		await vi.waitFor(() => expect(controller.ingestionError).toContain('File not found.'));
		expect(controller.result).toBeUndefined();
	});

	it('sends a remote-file request to the emulated adapter', async () => {
		adapterMocks.startIngestion.mockReturnValue({
			promise: Promise.resolve(ingestedResult),
			cancel: vi.fn()
		});
		const { controller } = createController(emulatedTarget);
		controller.form.sourceMode = 'remote-file';
		controller.form.remoteFileUrl = 'https://example.com/events.csv';
		controller.form.remoteFileSkipFirstLine = true;
		expect(controller.hasSourceInput).toBe(true);
		expect(controller.sourceShapeCheckUnavailable).toBe(false);
		expect(controller.confirmationSource).toBe(controller.resolvedRemoteFileUrl);
		expect(controller.canIngest).toBe(true);

		confirm(controller);
		await vi.waitFor(() => expect(controller.result).toEqual(ingestedResult));
		expect(adapterMocks.startIngestion.mock.calls[0][0]).toEqual({
			kind: 'emulated',
			request: {
				clusterId: 'emulated',
				database: 'Analytics',
				table: 'Events',
				format: 'csv',
				hasHeader: true,
				source: { kind: 'remote', url: 'https://example.com/events.csv' }
			}
		});
	});

	it('sends scanned inline CSV and local CSV files to the emulated adapter', async () => {
		adapterMocks.startIngestion.mockImplementation(() => ({
			promise: Promise.resolve(ingestedResult),
			cancel: vi.fn()
		}));
		const { controller } = createController(emulatedTarget);
		expect(controller.confirmationSource).toBe('Inline CSV');
		controller.form.inlineData = 'hello,extra';
		await vi.waitFor(() => expect(controller.canIngest).toBe(true));
		expect(controller.activeCsvPlan?.columnCount).toBe(2);
		expect(controller.extraSourceColumnCount).toBe(1);
		expect(controller.targetColumnShapeWarnings).toBeDefined();
		expect(controller.activeTable?.name).toBe('Events');

		confirm(controller);
		await vi.waitFor(() => expect(controller.result).toEqual(ingestedResult));
		expect(adapterMocks.startIngestion.mock.calls[0][0]).toMatchObject({
			kind: 'emulated',
			request: { format: 'csv', source: { kind: 'inline', data: expect.stringContaining('hello') } }
		});

		controller.form.sourceMode = 'inline-file';
		expect(controller.confirmationSource).toBe('Local file');
		selectFile(controller, new File(['Message\nhello\n'], 'events.csv'));
		await vi.waitFor(() => expect(controller.canIngest).toBe(true));
		expect(controller.confirmationSource).toBe('events.csv · 1 rows');

		confirm(controller);
		await vi.waitFor(() => expect(controller.inlineFileState).toBe('succeeded'));
		expect(adapterMocks.startIngestion.mock.calls[1][0]).toMatchObject({
			kind: 'emulated',
			request: { format: 'csv', hasHeader: true, source: { kind: 'file' } }
		});
	});

	it('discards inline CSV scans and cancels work when disposed', async () => {
		const { controller } = createController(kustainerTarget);
		controller.form.inlineData = 'hello';
		flushSync();
		expect(controller.inlineDataScanning).toBe(true);
		controller.cancelIngestion();
		controller.dispose();
		await new Promise((resolve) => setTimeout(resolve, 400));
		expect(controller.canIngest).toBe(false);
		expect(controller.inlineDataScanError).toBe('');
	});
});
