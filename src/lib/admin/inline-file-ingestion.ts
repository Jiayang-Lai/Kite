import type { KustoIngestionConfiguration } from '$lib/cluster/connections';
import { buildInlineIngestionCommand, getInlineFilePayloadBudget } from '$lib/kusto/ingestion';
import {
	formatBytes,
	hashInlineCsvChunk,
	planInlineCsvFile,
	readInlineCsvChunk,
	readInlineCsvPayload,
	type InlineCsvPlan
} from '$lib/kusto/inline-file';
import { startKustoManagementCommand } from '$lib/kusto/query-client';
import type { CancellableOperationContext } from '$lib/query/cancellable-operation.svelte';
import type { QueryExecution, QueryResult } from '$lib/types/query-result';
import { detectLocalFileFormat, type InlineFileState } from './data-ingestion-workspace';

export const EMULATION_MAX_FILE_BYTES = 512 * 1024 * 1024;
export const EMULATION_SCAN_CHUNK_BYTES = 16 * 1024 * 1024;

type ScanInlineFileOptions = {
	file: File;
	table: string;
	isEmulatedCluster: boolean;
	ingestion?: KustoIngestionConfiguration;
	hasHeader: boolean;
	signal?: AbortSignal;
	onProgress?: (percentage: number) => void;
};

type InlineFileScanResult = {
	format: 'csv' | 'parquet';
	plan?: InlineCsvPlan;
};

/** Validates and scans one browser-selected ingestion file without UI state dependencies. */
export async function scanInlineIngestionFile(
	options: ScanInlineFileOptions
): Promise<InlineFileScanResult> {
	const format = detectLocalFileFormat(options.file);
	if (!format || (!options.isEmulatedCluster && format !== 'csv')) {
		throw new Error(
			options.isEmulatedCluster
				? 'Local ingestion accepts .csv or .parquet files.'
				: 'Inline file ingestion currently accepts uncompressed .csv files only.'
		);
	}
	if (!options.file.size) throw new Error('The selected file is empty.');
	if (options.isEmulatedCluster && options.file.size > EMULATION_MAX_FILE_BYTES) {
		throw new Error(
			`The selected file is ${formatBytes(options.file.size)}; browser ingestion is limited to ${formatBytes(EMULATION_MAX_FILE_BYTES)}.`
		);
	}
	if (format === 'parquet') {
		options.onProgress?.(100);
		return { format };
	}

	const maxPayloadBytes = getInlineFilePayloadBudget(
		options.table,
		options.isEmulatedCluster
			? EMULATION_SCAN_CHUNK_BYTES
			: (options.ingestion?.maxInlineCommandBytes ?? 0)
	);
	const plan = await planInlineCsvFile(options.file, {
		maxFileBytes: options.isEmulatedCluster
			? EMULATION_MAX_FILE_BYTES
			: (options.ingestion?.maxInlineFileBytes ?? 0),
		maxPayloadBytes,
		hasHeader: options.hasHeader,
		signal: options.signal,
		onProgress(scannedBytes, totalBytes) {
			options.onProgress?.(Math.round((scannedBytes / totalBytes) * 100));
		}
	});
	options.onProgress?.(100);
	return { format, plan };
}

export async function scanInlineCsvText(data: string, hasHeader: boolean, maxLength: number) {
	const source = new Blob([data]);
	const plan = await planInlineCsvFile(source, {
		maxFileBytes: maxLength * 4,
		maxPayloadBytes: maxLength * 4,
		hasHeader
	});
	return { plan, payload: await readInlineCsvPayload(source, plan) };
}

export type InlineFileChunkProgress = {
	activeChunk?: number;
	completedChunks: number;
	completedRecords: number;
	extentIds: string[];
	result?: QueryResult;
};

export type InlineFileIngestionOutcome = InlineFileChunkProgress & {
	state: InlineFileState;
	error?: string;
};

export type RunInlineFileIngestionOptions = {
	file: File;
	plan: InlineCsvPlan;
	database: string;
	table: string;
	clusterUrl: string;
	maxInlineCommandBytes: number;
	startChunk: number;
	completedRecords: number;
	extentIds: string[];
	operation: CancellableOperationContext;
	onProgress: (progress: InlineFileChunkProgress) => void;
};

export type InlineFileIngestionDependencies = {
	readChunk: typeof readInlineCsvChunk;
	hashChunk: typeof hashInlineCsvChunk;
	buildCommand: typeof buildInlineIngestionCommand;
	startCommand: (database: string, command: string, clusterUrl: string) => QueryExecution;
	commandByteLength: (command: string) => number;
};

const defaultDependencies: InlineFileIngestionDependencies = {
	readChunk: readInlineCsvChunk,
	hashChunk: hashInlineCsvChunk,
	buildCommand: buildInlineIngestionCommand,
	startCommand: startKustoManagementCommand,
	commandByteLength: (command) => new TextEncoder().encode(command).byteLength
};

/** Executes resumable inline-file chunks while keeping cancellation outside the Svelte view. */
export function createInlineFileIngestionExecutor(
	dependencies: InlineFileIngestionDependencies = defaultDependencies
) {
	let cancelRequested = false;

	async function run(options: RunInlineFileIngestionOptions) {
		cancelRequested = false;
		let completedChunks = options.startChunk;
		let completedRecords = options.completedRecords;
		let extentIds = [...options.extentIds];
		let result: QueryResult | undefined;

		try {
			for (let index = completedChunks; index < options.plan.chunks.length; index += 1) {
				if (cancelRequested || !options.operation.isCurrent()) break;
				const chunk = options.plan.chunks[index];
				options.onProgress({
					activeChunk: index,
					completedChunks,
					completedRecords,
					extentIds,
					result
				});
				const data = await dependencies.readChunk(options.file, chunk);
				const hash = await dependencies.hashChunk(options.database, options.table, data);
				const command = dependencies.buildCommand({
					table: options.table,
					data,
					ingestBy: `kite-inline-file:${hash}`
				});
				if (dependencies.commandByteLength(command) > options.maxInlineCommandBytes) {
					throw new Error(`Chunk ${index + 1} exceeds the configured inline command limit.`);
				}
				if (cancelRequested || !options.operation.isCurrent()) break;

				const execution = dependencies.startCommand(options.database, command, options.clusterUrl);
				options.operation.setExecution(execution);
				result = await execution.promise;
				if (!options.operation.isCurrent()) return undefined;
				completedChunks = index + 1;
				completedRecords += chunk.recordCount;
				extentIds = [...extentIds, ...getExtentIds(result)];
				options.operation.setExecution();
				options.onProgress({
					activeChunk: index,
					completedChunks,
					completedRecords,
					extentIds,
					result
				});
			}

			if (!options.operation.isCurrent()) return undefined;
			const state: InlineFileState = cancelRequested
				? 'cancelled'
				: completedChunks === options.plan.chunks.length
					? 'succeeded'
					: 'partial';
			return {
				state,
				completedChunks,
				completedRecords,
				extentIds,
				result,
				error: cancelRequested
					? 'Stopped inline-file ingestion. Completed chunks remain ingested; the active chunk may also complete.'
					: undefined
			} satisfies InlineFileIngestionOutcome;
		} finally {
			options.onProgress({
				activeChunk: undefined,
				completedChunks,
				completedRecords,
				extentIds,
				result
			});
		}
	}

	return {
		run,
		cancel() {
			cancelRequested = true;
		},
		get cancelRequested() {
			return cancelRequested;
		}
	};
}

function getExtentIds(result: QueryResult) {
	const extentColumn = result.columns.findIndex(
		(column) => column.name.toLowerCase() === 'extentid'
	);
	if (extentColumn < 0) return [];
	return result.rows
		.map((row) => row[extentColumn])
		.filter((value): value is string => typeof value === 'string' && Boolean(value));
}
