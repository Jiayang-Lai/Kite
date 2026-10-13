import { afterEach, describe, expect, it, vi } from 'vitest';

const adapterMocks = vi.hoisted(() => ({ startIngestion: vi.fn() }));

vi.mock('$lib/admin/ingestion-adapter', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/admin/ingestion-adapter')>()),
	startIngestion: adapterMocks.startIngestion
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
});
