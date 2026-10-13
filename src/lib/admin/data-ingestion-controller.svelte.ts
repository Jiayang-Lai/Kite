import {
	detectLocalFileFormat,
	getInlineFileStatusLabel,
	getTargetColumnShapeWarnings,
	prepareIngestionCommand,
	resolveIngestionSourceLocations,
	type IngestionSourceMode,
	type InlineFileState
} from '$lib/admin/data-ingestion-workspace';
import {
	createInlineFileIngestionExecutor,
	scanInlineCsvText,
	scanInlineIngestionFile
} from '$lib/admin/inline-file-ingestion';
import {
	formatIngestionError,
	startIngestion,
	type IngestionRequest
} from '$lib/admin/ingestion-adapter';
import type { KustoIngestionConfiguration } from '$lib/cluster/connections';
import type { EmulatedIngestionRequest } from '$lib/emulation/data-ingestion';
import type { MountedFileFormat } from '$lib/kusto/ingestion';
import { compareCsvShape } from '$lib/kusto/ingestion-guardrails';
import { formatBytes, type InlineCsvPlan } from '$lib/kusto/inline-file';
import { getErrorMessage } from '$lib/query/error-message';
import { createCancellableOperation } from '$lib/query/cancellable-operation.svelte';
import type { KustoDatabaseSchema } from '$lib/types/kusto-schema';
import { isOperationCancelled, type QueryResult } from '$lib/types/query-result';

export const INLINE_DATA_MAX_LENGTH = 100_000;
const INLINE_DATA_SCAN_DEBOUNCE_MS = 300;

/** The connection and selection an ingestion targets, read live from the component's props. */
export type DataIngestionTarget = {
	databases?: KustoDatabaseSchema;
	selectedDatabase: string;
	selectedTable?: string;
	clusterId: string;
	clusterUrl: string;
	ingestion?: KustoIngestionConfiguration;
	isEmulatedCluster: boolean;
};

/**
 * Owns the data-ingestion workflow: source inputs, CSV scanning and guardrails, confirmation,
 * execution through the emulated or Kustainer adapter, chunked inline-file progress, and
 * cancellation. The component renders this state and keeps only presentation concerns.
 *
 * Must be created during component initialization because it registers effects.
 */
export function createDataIngestionController(getTarget: () => DataIngestionTarget) {
	const target = $derived(getTarget());
	/** User-editable inputs, bound directly by the form. */
	const form = $state({
		sourceMode: 'inline' as IngestionSourceMode,
		inlineData: '',
		inlineDataHasHeader: false,
		selectedFiles: undefined as FileList | undefined,
		inlineFileHasHeader: true,
		relativePath: '',
		fileFormat: 'parquet' as MountedFileFormat,
		remoteFileUrl: '',
		remoteFileFormat: 'csv' as MountedFileFormat,
		remoteFileSkipFirstLine: false,
		showConfirmation: false,
		confirmationText: ''
	});

	let inlineDataPlan = $state.raw<InlineCsvPlan>();
	let inlineDataPayload = $state('');
	let inlineDataScanError = $state('');
	let inlineDataScanning = $state(false);
	let inlineFile = $state.raw<File>();
	let inlineFileVersion = $state(0);
	let inlineFilePlan = $state.raw<InlineCsvPlan>();
	let inlineFileState = $state<InlineFileState>('idle');
	let inlineFileError = $state('');
	let inlineFileScanProgress = $state(0);
	let completedFileChunks = $state(0);
	let completedFileRecords = $state(0);
	let activeFileChunk = $state<number>();
	let extentIds = $state<string[]>([]);
	let result = $state<QueryResult>();
	let ingestionError = $state('');
	let pendingCommand = $state('');
	let plannedInlineFileKey = '';
	let scanRequestId = 0;
	let inlineDataScanRequestId = 0;
	let scanController: AbortController | undefined;
	const ingestionOperation = createCancellableOperation();
	const inlineFileIngestion = createInlineFileIngestionExecutor();
	const isRunning = $derived(ingestionOperation.isRunning);

	const activeTable = $derived.by(() => {
		const { databases, selectedDatabase, selectedTable } = target;
		const database = selectedDatabase ? databases?.[selectedDatabase] : undefined;
		return selectedTable
			? database?.tables.find((table) => table.name === selectedTable)
			: undefined;
	});
	const localFileFormat = $derived(detectLocalFileFormat(inlineFile));
	const sourceLocations = $derived(
		resolveIngestionSourceLocations({
			ingestion: target.ingestion,
			relativePath: form.relativePath,
			remoteFileUrl: form.remoteFileUrl,
			isEmulatedCluster: target.isEmulatedCluster
		})
	);
	const preparedCommand = $derived(
		prepareIngestionCommand({
			sourceMode: form.sourceMode,
			isEmulatedCluster: target.isEmulatedCluster,
			ingestion: target.ingestion,
			selectedTable: target.selectedTable,
			inlineData: form.inlineData,
			inlineDataPayload,
			inlineFile,
			localFileFormat,
			remoteFileUrl: form.remoteFileUrl,
			remoteFileFormat: form.remoteFileFormat,
			remoteFileSkipFirstLine: form.remoteFileSkipFirstLine,
			relativePath: form.relativePath,
			fileFormat: form.fileFormat
		})
	);
	const activeCsvPlan = $derived(
		form.sourceMode === 'inline'
			? inlineDataPlan
			: form.sourceMode === 'inline-file'
				? inlineFilePlan
				: undefined
	);
	// Only CSV sources have a plan, so mounted and remote files have no guardrails here.
	const activeGuardrails = $derived(
		activeCsvPlan && activeTable ? compareCsvShape(activeCsvPlan, activeTable.columns) : []
	);
	const targetColumnShapeWarnings = $derived(
		getTargetColumnShapeWarnings(activeCsvPlan, activeTable?.columns)
	);
	const extraSourceColumnCount = $derived(
		activeCsvPlan && activeTable
			? Math.max(0, activeCsvPlan.columnCount - activeTable.columns.length)
			: 0
	);
	const sourceShapeCheckUnavailable = $derived(
		!target.isEmulatedCluster && (form.sourceMode === 'file' || form.sourceMode === 'remote-file')
	);
	const canIngest = $derived.by(() => {
		const { ingestion, isEmulatedCluster, selectedDatabase, selectedTable } = target;
		if (!(ingestion || isEmulatedCluster) || !selectedDatabase || !selectedTable || isRunning) {
			return false;
		}
		switch (form.sourceMode) {
			case 'inline':
				return Boolean(inlineDataPlan && !inlineDataScanError);
			case 'inline-file':
				return isEmulatedCluster
					? Boolean(
							inlineFile &&
							localFileFormat &&
							(localFileFormat === 'parquet' || inlineFilePlan) &&
							['ready', 'cancelled', 'failed'].includes(inlineFileState)
						)
					: Boolean(
							inlineFilePlan &&
							['ready', 'partial', 'cancelled', 'failed'].includes(inlineFileState)
						);
			default:
				return Boolean(preparedCommand.command);
		}
	});
	const hasSourceInput = $derived(
		form.sourceMode === 'inline'
			? Boolean(form.inlineData)
			: form.sourceMode === 'inline-file'
				? Boolean(inlineFile)
				: form.sourceMode === 'remote-file'
					? Boolean(form.remoteFileUrl)
					: Boolean(form.relativePath)
	);
	const fileExecutionProgress = $derived(
		inlineFilePlan?.chunks.length
			? Math.round((completedFileChunks / inlineFilePlan.chunks.length) * 100)
			: 0
	);
	const inlineFileSourceSummary = $derived(
		inlineFile
			? inlineFilePlan
				? `${inlineFile.name} · ${inlineFilePlan.totalRecords.toLocaleString()} rows${target.isEmulatedCluster ? '' : ` · ${inlineFilePlan.chunks.length} chunks`}`
				: `${inlineFile.name} · ${formatBytes(inlineFile.size)}`
			: target.isEmulatedCluster
				? 'Local file'
				: 'Inline CSV file'
	);
	const confirmationSource = $derived(
		form.sourceMode === 'inline'
			? 'Inline CSV'
			: form.sourceMode === 'inline-file'
				? inlineFileSourceSummary
				: form.sourceMode === 'remote-file'
					? sourceLocations.remoteFileUrl
					: sourceLocations.mountedFilePath
	);

	// Debounced scan of pasted CSV text; stale scans are discarded by request ID.
	$effect(() => {
		const data = form.inlineData;
		const hasHeader = form.inlineDataHasHeader;
		const nextScanRequestId = ++inlineDataScanRequestId;
		inlineDataPlan = undefined;
		inlineDataPayload = '';
		inlineDataScanError = '';
		inlineDataScanning = Boolean(data.trim());
		if (!data.trim()) return;

		const timer = setTimeout(() => {
			void (async () => {
				try {
					const { plan, payload } = await scanInlineCsvText(
						data,
						hasHeader,
						INLINE_DATA_MAX_LENGTH
					);
					if (nextScanRequestId !== inlineDataScanRequestId) return;
					inlineDataPlan = plan;
					inlineDataPayload = payload;
				} catch (error) {
					if (nextScanRequestId !== inlineDataScanRequestId) return;
					inlineDataScanError = error instanceof Error ? error.message : String(error);
				} finally {
					if (nextScanRequestId === inlineDataScanRequestId) inlineDataScanning = false;
				}
			})();
		}, INLINE_DATA_SCAN_DEBOUNCE_MS);

		return () => clearTimeout(timer);
	});

	// Browser DuckDB cannot read files mounted into a Kustainer container.
	$effect(() => {
		if (target.isEmulatedCluster && form.sourceMode === 'file') form.sourceMode = 'inline';
	});

	// Plan a selected local file once per file, target table, and header setting.
	$effect(() => {
		const file = inlineFile;
		const table = target.selectedTable;
		const planKey = `${inlineFileVersion}\0${table ?? ''}\0${form.inlineFileHasHeader}`;
		if (
			!file ||
			!table ||
			(!target.ingestion && !target.isEmulatedCluster) ||
			planKey === plannedInlineFileKey ||
			isRunning
		) {
			return;
		}
		plannedInlineFileKey = planKey;
		void scanInlineFile(file, table);
	});

	function selectInlineFile() {
		inlineFile = form.selectedFiles?.[0];
		inlineFileVersion += 1;
	}

	function rescanInlineFile() {
		if (!inlineFile) return;
		plannedInlineFileKey = '';
		inlineFileVersion += 1;
	}

	async function scanInlineFile(file: File, table: string) {
		const nextScanRequestId = ++scanRequestId;
		scanController?.abort();
		scanController = new AbortController();
		inlineFilePlan = undefined;
		inlineFileState = 'scanning';
		inlineFileError = '';
		inlineFileScanProgress = 0;
		completedFileChunks = 0;
		completedFileRecords = 0;
		extentIds = [];
		try {
			const scan = await scanInlineIngestionFile({
				file,
				table,
				isEmulatedCluster: target.isEmulatedCluster,
				ingestion: target.ingestion,
				hasHeader: form.inlineFileHasHeader,
				signal: scanController.signal,
				onProgress(progress) {
					if (nextScanRequestId === scanRequestId) inlineFileScanProgress = progress;
				}
			});
			if (nextScanRequestId !== scanRequestId) return;
			inlineFilePlan = scan.plan;
			inlineFileState = 'ready';
		} catch (error) {
			if (nextScanRequestId !== scanRequestId) return;
			if (error instanceof DOMException && error.name === 'AbortError') {
				inlineFileState = 'cancelled';
				inlineFileError = 'CSV scan cancelled.';
			} else {
				inlineFileState = 'failed';
				inlineFileError = error instanceof Error ? error.message : String(error);
			}
		} finally {
			if (nextScanRequestId === scanRequestId) scanController = undefined;
		}
	}

	function currentEmulatedIngestion(): EmulatedIngestionRequest {
		const { clusterId, selectedDatabase: database, selectedTable: table } = target;
		if (!table) throw new Error('Select a target table.');

		if (form.sourceMode === 'inline') {
			return {
				clusterId,
				database,
				table,
				format: 'csv',
				source: { kind: 'inline', data: inlineDataPayload }
			};
		}
		if (form.sourceMode === 'inline-file') {
			if (!inlineFile || !localFileFormat) throw new Error('Select a local CSV or Parquet file.');
			return {
				clusterId,
				database,
				table,
				format: localFileFormat,
				hasHeader: localFileFormat === 'csv' && form.inlineFileHasHeader,
				source: { kind: 'file', file: inlineFile }
			};
		}
		if (form.sourceMode === 'remote-file') {
			return {
				clusterId,
				database,
				table,
				format: form.remoteFileFormat,
				hasHeader: form.remoteFileFormat === 'csv' && form.remoteFileSkipFirstLine,
				source: { kind: 'remote', url: form.remoteFileUrl }
			};
		}
		throw new Error('Mounted-container files are not available to browser DuckDB.');
	}

	function requestIngestion() {
		if (!canIngest) {
			ingestionError = preparedCommand.error;
			return;
		}
		pendingCommand =
			form.sourceMode === 'inline-file' && !target.isEmulatedCluster
				? `${inlineFilePlan?.chunks.length ?? 0} sequential .ingest inline commands with per-chunk ingest-by tags`
				: preparedCommand.command;
		form.confirmationText = '';
		form.showConfirmation = true;
	}

	function confirmIngestion() {
		if (form.confirmationText !== 'RUN' || !pendingCommand) return;
		form.showConfirmation = false;
		if (form.sourceMode === 'inline-file' && !target.isEmulatedCluster) {
			void runInlineFileIngestion();
		} else {
			void runIngestion(pendingCommand);
		}
	}

	async function runIngestion(command: string) {
		const { isEmulatedCluster, selectedDatabase, clusterUrl } = target;
		const tracksFileState = isEmulatedCluster && form.sourceMode === 'inline-file';
		ingestionError = '';
		result = undefined;
		if (tracksFileState) inlineFileState = 'running';
		await ingestionOperation.run(
			async (operation) => {
				const request: IngestionRequest = isEmulatedCluster
					? { kind: 'emulated', request: currentEmulatedIngestion() }
					: { kind: 'kustainer', database: selectedDatabase, command, clusterUrl };
				const execution = startIngestion(request);
				operation.setExecution(execution);
				return execution.promise;
			},
			{
				onSuccess: (completedResult) => {
					result = completedResult;
					if (tracksFileState) inlineFileState = 'succeeded';
				},
				onError: (error) => {
					ingestionError = formatIngestionError(
						error,
						isEmulatedCluster ? 'emulated' : 'kustainer'
					);
					if (tracksFileState) {
						inlineFileError = ingestionError;
						inlineFileState = isOperationCancelled(error) ? 'cancelled' : 'failed';
					}
				}
			}
		);
	}

	async function runInlineFileIngestion() {
		const file = inlineFile;
		const plan = inlineFilePlan;
		const { selectedTable: table, selectedDatabase: database, clusterUrl, ingestion } = target;
		if (!file || !plan || !table || !ingestion) return;

		ingestionError = '';
		result = undefined;
		inlineFileState = 'running';
		await ingestionOperation.run(
			async (operation) =>
				inlineFileIngestion.run({
					file,
					plan,
					database,
					table,
					clusterUrl,
					maxInlineCommandBytes: ingestion.maxInlineCommandBytes,
					startChunk: completedFileChunks,
					completedRecords: completedFileRecords,
					extentIds,
					operation,
					onProgress: (progress) => {
						if (!operation.isCurrent()) return;
						activeFileChunk = progress.activeChunk;
						completedFileChunks = progress.completedChunks;
						completedFileRecords = progress.completedRecords;
						extentIds = progress.extentIds;
						if (progress.result) result = progress.result;
					}
				}),
			{
				onSuccess: (outcome) => {
					if (!outcome) return;
					inlineFileState = outcome.state;
					ingestionError = outcome.error ?? '';
				},
				onError: (error) => {
					ingestionError = isOperationCancelled(error)
						? 'Stopped inline-file ingestion. Completed chunks remain ingested; the active chunk may also complete.'
						: getErrorMessage(error);
					inlineFileError = ingestionError;
					inlineFileState = completedFileChunks
						? 'partial'
						: inlineFileIngestion.cancelRequested
							? 'cancelled'
							: 'failed';
				}
			}
		);
	}

	function cancelIngestion() {
		inlineFileIngestion.cancel();
		scanController?.abort();
		ingestionOperation.cancel();
	}

	return {
		form,
		get inlineDataScanError() {
			return inlineDataScanError;
		},
		get inlineDataScanning() {
			return inlineDataScanning;
		},
		get inlineFile() {
			return inlineFile;
		},
		get inlineFilePlan() {
			return inlineFilePlan;
		},
		get inlineFileState() {
			return inlineFileState;
		},
		get inlineFileStatusLabel() {
			return getInlineFileStatusLabel(inlineFileState);
		},
		get inlineFileError() {
			return inlineFileError;
		},
		get inlineFileScanProgress() {
			return inlineFileScanProgress;
		},
		get completedFileChunks() {
			return completedFileChunks;
		},
		get completedFileRecords() {
			return completedFileRecords;
		},
		get activeFileChunk() {
			return activeFileChunk;
		},
		get extentIds() {
			return extentIds;
		},
		get fileExecutionProgress() {
			return fileExecutionProgress;
		},
		get result() {
			return result;
		},
		get ingestionError() {
			return ingestionError;
		},
		get isRunning() {
			return isRunning;
		},
		get pendingCommand() {
			return pendingCommand;
		},
		get confirmationSource() {
			return confirmationSource;
		},
		get activeTable() {
			return activeTable;
		},
		get localFileFormat() {
			return localFileFormat;
		},
		get resolvedFilePath() {
			return sourceLocations.mountedFilePath;
		},
		get resolvedRemoteFileUrl() {
			return sourceLocations.remoteFileUrl;
		},
		get preparedCommand() {
			return preparedCommand;
		},
		get activeCsvPlan() {
			return activeCsvPlan;
		},
		get activeGuardrails() {
			return activeGuardrails;
		},
		get targetColumnShapeWarnings() {
			return targetColumnShapeWarnings;
		},
		get extraSourceColumnCount() {
			return extraSourceColumnCount;
		},
		get sourceShapeCheckUnavailable() {
			return sourceShapeCheckUnavailable;
		},
		get canIngest() {
			return canIngest;
		},
		get hasSourceInput() {
			return hasSourceInput;
		},
		selectInlineFile,
		rescanInlineFile,
		requestIngestion,
		confirmIngestion,
		cancelIngestion,
		dispose() {
			scanRequestId += 1;
			inlineDataScanRequestId += 1;
			scanController?.abort();
			ingestionOperation.dispose();
		}
	};
}

export type DataIngestionController = ReturnType<typeof createDataIngestionController>;
