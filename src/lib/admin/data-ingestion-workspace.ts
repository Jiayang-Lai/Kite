import {
	buildInlineIngestionCommand,
	buildMountedFileIngestionCommand,
	buildRemoteFileIngestionCommand,
	resolveMountedFilePath,
	resolveRemoteFileUrl,
	type MountedFileFormat
} from '$lib/kusto/ingestion';
import { describeEmulatedRemoteUrl, resolveEmulatedRemoteUrl } from '$lib/emulation/data-ingestion';
import type { KustoIngestionConfiguration } from '$lib/cluster/connections';
import type { InlineCsvPlan } from '$lib/kusto/inline-file';
import type { KustoColumn } from '$lib/types/kusto-schema';

export type IngestionSourceMode = 'inline' | 'inline-file' | 'file' | 'remote-file';
export type InlineFileState =
	'idle' | 'scanning' | 'ready' | 'running' | 'partial' | 'cancelled' | 'succeeded' | 'failed';

export type TargetColumnShapeWarning = {
	kind: 'header-order' | 'missing-source-column';
	message: string;
};

type PrepareIngestionCommandOptions = {
	sourceMode: IngestionSourceMode;
	isEmulatedCluster: boolean;
	ingestion?: KustoIngestionConfiguration;
	selectedTable?: string;
	inlineData: string;
	inlineDataPayload: string;
	inlineFile?: File;
	localFileFormat?: MountedFileFormat;
	remoteFileUrl: string;
	remoteFileFormat: MountedFileFormat;
	remoteFileSkipFirstLine: boolean;
	relativePath: string;
	fileFormat: MountedFileFormat;
};

export function detectLocalFileFormat(file?: Pick<File, 'name'>): MountedFileFormat | undefined {
	const name = file?.name.toLowerCase();
	if (name?.endsWith('.csv')) return 'csv';
	if (name?.endsWith('.parquet')) return 'parquet';
	return undefined;
}

/** Builds the command preview without coupling validation to the Svelte component lifecycle. */
export function prepareIngestionCommand(options: PrepareIngestionCommandOptions) {
	try {
		if (options.isEmulatedCluster) {
			if (options.sourceMode === 'inline') {
				if (!options.inlineData.trim()) throw new Error('Enter at least one CSV row to ingest.');
				return { command: 'DuckDB append from inline CSV rows', error: '' };
			}
			if (options.sourceMode === 'inline-file') {
				if (!options.inlineFile) throw new Error('Select a local CSV or Parquet file.');
				if (!options.localFileFormat) throw new Error('Select a file ending in .csv or .parquet.');
				return {
					command: `DuckDB append from local ${options.localFileFormat.toUpperCase()} file`,
					error: ''
				};
			}
			if (options.sourceMode === 'remote-file') {
				resolveEmulatedRemoteUrl(options.remoteFileUrl);
				return {
					command: `DuckDB append from remote ${options.remoteFileFormat.toUpperCase()} file`,
					error: ''
				};
			}
			throw new Error('Mounted-container files are available for Kustainer connections only.');
		}

		if (!options.ingestion)
			throw new Error('Data ingestion is not configured for this connection.');
		if (options.sourceMode === 'inline-file') return { command: '', error: '' };

		const table = options.selectedTable ?? '';
		const command =
			options.sourceMode === 'inline'
				? buildInlineIngestionCommand({ table, data: options.inlineDataPayload })
				: options.sourceMode === 'remote-file'
					? buildRemoteFileIngestionCommand({
							table,
							url: options.remoteFileUrl,
							format: options.remoteFileFormat,
							ignoreFirstRecord:
								options.remoteFileFormat === 'csv' && options.remoteFileSkipFirstLine
						})
					: buildMountedFileIngestionCommand({
							table,
							containerRoot: options.ingestion.containerRoot,
							relativePath: options.relativePath,
							format: options.fileFormat
						});
		return { command, error: '' };
	} catch (error) {
		return { command: '', error: error instanceof Error ? error.message : String(error) };
	}
}

export function resolveIngestionSourceLocations(options: {
	ingestion?: KustoIngestionConfiguration;
	relativePath: string;
	remoteFileUrl: string;
	isEmulatedCluster: boolean;
}) {
	let mountedFilePath = '';
	let remoteFileUrl = '';
	try {
		if (options.ingestion && options.relativePath.trim()) {
			mountedFilePath = resolveMountedFilePath(
				options.ingestion.containerRoot,
				options.relativePath
			);
		}
	} catch {
		// The prepared command exposes the actionable validation message.
	}
	try {
		if (options.remoteFileUrl.trim()) {
			remoteFileUrl = options.isEmulatedCluster
				? describeEmulatedRemoteUrl(options.remoteFileUrl)
				: resolveRemoteFileUrl(options.remoteFileUrl);
		}
	} catch {
		// The prepared command exposes the actionable validation message.
	}
	return { mountedFilePath, remoteFileUrl };
}

export function getTargetColumnShapeWarnings(
	plan: InlineCsvPlan | undefined,
	columns: readonly KustoColumn[] | undefined
): Array<TargetColumnShapeWarning | undefined> {
	if (!plan || !columns) return [];
	return columns.map((column, index) => {
		if (index >= plan.columnCount) {
			return {
				kind: 'missing-source-column',
				message: `No source column at position ${index + 1}.`
			};
		}
		const sourceHeader = plan.headerColumns?.[index];
		if (sourceHeader !== undefined && sourceHeader !== column.name) {
			return { kind: 'header-order', message: `Source header: ${sourceHeader}` };
		}
		return undefined;
	});
}

export function getInlineFileStatusLabel(state: InlineFileState) {
	return (
		(
			{
				ready: 'Ready',
				running: 'Running',
				partial: 'Partial',
				cancelled: 'Cancelled',
				succeeded: 'Complete',
				failed: 'Failed'
			} as Partial<Record<InlineFileState, string>>
		)[state] ?? 'Ready'
	);
}
