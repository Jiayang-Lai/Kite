import { describe, expect, it, vi } from 'vitest';

import type { CancellableOperationContext } from '$lib/query/cancellable-operation.svelte';
import type { QueryResult } from '$lib/types/query-result';
import {
	createInlineFileIngestionExecutor,
	scanInlineCsvText,
	scanInlineIngestionFile,
	type InlineFileChunkProgress,
	type InlineFileIngestionDependencies
} from './inline-file-ingestion';

const ingestion = {
	mode: 'kustainer' as const,
	containerRoot: '/data',
	maxInlineFileBytes: 10_000,
	maxInlineCommandBytes: 10_000
};

const result = (extentId: string): QueryResult => ({
	columns: [{ name: 'ExtentId', type: 'String' }],
	rows: [[extentId], [null]],
	totalRowCount: 2,
	renderedRowCount: 2,
	warnings: [],
	elapsedMs: 1,
	clientRequestId: extentId
});

function plan() {
	return {
		fileBytes: 8,
		dataBytes: 8,
		totalRecords: 2,
		columnCount: 1,
		inconsistentRecordCount: 0,
		chunks: [
			{ index: 0, byteStart: 0, byteEnd: 4, recordCount: 1, payloadBytes: 4 },
			{ index: 1, byteStart: 4, byteEnd: 8, recordCount: 1, payloadBytes: 4 }
		]
	};
}

function operation() {
	let current = true;
	const setExecution = vi.fn();
	return {
		context: {
			isCurrent: () => current,
			setExecution
		} satisfies CancellableOperationContext,
		setCurrent(value: boolean) {
			current = value;
		},
		setExecution
	};
}

function dependencies(): InlineFileIngestionDependencies {
	let request = 0;
	return {
		readChunk: vi.fn().mockResolvedValue('row\n'),
		hashChunk: vi.fn().mockResolvedValue('hash'),
		buildCommand: vi.fn(({ ingestBy }) => `command ${ingestBy}`),
		startCommand: vi.fn(() => ({
			promise: Promise.resolve(result(`extent-${++request}`)),
			cancel: vi.fn()
		})),
		commandByteLength: vi.fn(() => 100)
	};
}

describe('inline file scanning', () => {
	it('scans inline CSV text and returns the payload without its header', async () => {
		await expect(scanInlineCsvText('Id\n1\n2\n', true, 100)).resolves.toMatchObject({
			plan: { totalRecords: 2, columnCount: 1 },
			payload: '1\n2\n'
		});
	});

	it('accepts Parquet only for emulated ingestion', async () => {
		const file = new File(['parquet'], 'events.parquet');
		const onProgress = vi.fn();

		await expect(
			scanInlineIngestionFile({
				file,
				table: 'Events',
				isEmulatedCluster: true,
				hasHeader: false,
				onProgress
			})
		).resolves.toEqual({ format: 'parquet' });
		expect(onProgress).toHaveBeenCalledWith(100);
		await expect(
			scanInlineIngestionFile({
				file,
				table: 'Events',
				isEmulatedCluster: false,
				ingestion,
				hasHeader: false
			})
		).rejects.toThrow('uncompressed .csv files only');
	});

	it('validates empty and unsupported local files', async () => {
		await expect(
			scanInlineIngestionFile({
				file: new File([], 'events.csv'),
				table: 'Events',
				isEmulatedCluster: true,
				hasHeader: false
			})
		).rejects.toThrow('selected file is empty');
		await expect(
			scanInlineIngestionFile({
				file: new File(['{}'], 'events.json'),
				table: 'Events',
				isEmulatedCluster: true,
				hasHeader: false
			})
		).rejects.toThrow('accepts .csv or .parquet');
	});

	it('reports CSV scan progress and returns a chunk plan', async () => {
		const onProgress = vi.fn();
		const scan = await scanInlineIngestionFile({
			file: new File(['Id,Message\n1,hello\n'], 'events.csv'),
			table: 'Events',
			isEmulatedCluster: false,
			ingestion,
			hasHeader: true,
			onProgress
		});

		expect(scan.format).toBe('csv');
		expect(scan.plan).toMatchObject({ totalRecords: 1, columnCount: 2 });
		expect(onProgress).toHaveBeenLastCalledWith(100);
	});
});

describe('inline file ingestion executor', () => {
	it('executes chunks sequentially and reports resumable progress', async () => {
		const deps = dependencies();
		const executor = createInlineFileIngestionExecutor(deps);
		const activeOperation = operation();
		const progress: InlineFileChunkProgress[] = [];

		const outcome = await executor.run({
			file: new File(['1\n2\n'], 'events.csv'),
			plan: plan(),
			database: 'Analytics',
			table: 'Events',
			clusterUrl: 'https://cluster',
			maxInlineCommandBytes: 1000,
			startChunk: 0,
			completedRecords: 0,
			extentIds: [],
			operation: activeOperation.context,
			onProgress: (value) => progress.push(value)
		});

		expect(outcome).toMatchObject({
			state: 'succeeded',
			completedChunks: 2,
			completedRecords: 2,
			extentIds: ['extent-1', 'extent-2']
		});
		expect(deps.startCommand).toHaveBeenCalledTimes(2);
		expect(activeOperation.setExecution).toHaveBeenCalledTimes(4);
		expect(progress.at(-1)?.activeChunk).toBeUndefined();
	});

	it('stops before the next chunk after cancellation and returns a partial outcome', async () => {
		const executor = createInlineFileIngestionExecutor(dependencies());
		const activeOperation = operation();

		const outcome = await executor.run({
			file: new File(['1\n2\n'], 'events.csv'),
			plan: plan(),
			database: 'Analytics',
			table: 'Events',
			clusterUrl: 'https://cluster',
			maxInlineCommandBytes: 1000,
			startChunk: 0,
			completedRecords: 0,
			extentIds: [],
			operation: activeOperation.context,
			onProgress: (progress) => {
				if (progress.completedChunks === 1) executor.cancel();
			}
		});

		expect(outcome).toMatchObject({
			state: 'cancelled',
			completedChunks: 1,
			completedRecords: 1,
			error: expect.stringContaining('Completed chunks remain ingested')
		});
	});

	it('rejects an oversized generated command before starting it', async () => {
		const deps = dependencies();
		deps.commandByteLength = vi.fn(() => 1001);
		const executor = createInlineFileIngestionExecutor(deps);

		await expect(
			executor.run({
				file: new File(['1\n'], 'events.csv'),
				plan: { ...plan(), chunks: [plan().chunks[0]], totalRecords: 1 },
				database: 'Analytics',
				table: 'Events',
				clusterUrl: 'https://cluster',
				maxInlineCommandBytes: 1000,
				startChunk: 0,
				completedRecords: 0,
				extentIds: [],
				operation: operation().context,
				onProgress: vi.fn()
			})
		).rejects.toThrow('Chunk 1 exceeds');
		expect(deps.startCommand).not.toHaveBeenCalled();
	});

	it('suppresses completion after its owning operation becomes stale', async () => {
		const deps = dependencies();
		const activeOperation = operation();
		deps.startCommand = vi.fn(() => ({
			promise: Promise.resolve(result('extent')).then((value) => {
				activeOperation.setCurrent(false);
				return value;
			}),
			cancel: vi.fn()
		}));
		const executor = createInlineFileIngestionExecutor(deps);

		const outcome = await executor.run({
			file: new File(['1\n'], 'events.csv'),
			plan: { ...plan(), chunks: [plan().chunks[0]], totalRecords: 1 },
			database: 'Analytics',
			table: 'Events',
			clusterUrl: 'https://cluster',
			maxInlineCommandBytes: 1000,
			startChunk: 0,
			completedRecords: 0,
			extentIds: [],
			operation: activeOperation.context,
			onProgress: vi.fn()
		});

		expect(outcome).toBeUndefined();
	});
});
