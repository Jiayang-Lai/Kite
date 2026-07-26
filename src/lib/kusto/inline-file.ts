const DOUBLE_QUOTE = 0x22;
const COMMA = 0x2c;
const CARRIAGE_RETURN = 0x0d;
const LINE_FEED = 0x0a;
const UTF8_BOM = [0xef, 0xbb, 0xbf];

export type InlineCsvChunk = {
	index: number;
	byteStart: number;
	byteEnd: number;
	recordCount: number;
	payloadBytes: number;
};

export type InlineCsvPlan = {
	fileBytes: number;
	dataBytes: number;
	totalRecords: number;
	columnCount: number;
	inconsistentRecordCount: number;
	header?: string;
	headerColumnCount?: number;
	chunks: InlineCsvChunk[];
};

export type InlineCsvPlanOptions = {
	maxFileBytes: number;
	maxPayloadBytes: number;
	hasHeader?: boolean;
	readBlockBytes?: number;
	signal?: AbortSignal;
	onProgress?: (scannedBytes: number, totalBytes: number) => void;
};

function throwIfAborted(signal?: AbortSignal) {
	if (signal?.aborted) throw new DOMException('CSV scan cancelled.', 'AbortError');
}

/**
 * Scans a UTF-8 CSV Blob without retaining its contents. Chunk boundaries are
 * emitted only after complete CSV records, including records with quoted newlines.
 */
export async function planInlineCsvFile(
	file: Blob,
	{
		maxFileBytes,
		maxPayloadBytes,
		hasHeader = false,
		readBlockBytes = 64 * 1024,
		signal,
		onProgress
	}: InlineCsvPlanOptions
): Promise<InlineCsvPlan> {
	if (!file.size) throw new Error('The selected CSV file is empty.');
	if (file.size > maxFileBytes) {
		throw new Error(
			`The selected file is ${formatBytes(file.size)}; inline files are limited to ${formatBytes(maxFileBytes)}.`
		);
	}
	if (maxPayloadBytes <= 0) throw new Error('The inline chunk size must be greater than zero.');

	const blockSize = Math.max(3, readBlockBytes);
	const utf8Decoder = new TextDecoder('utf-8', { fatal: true });
	const chunks: InlineCsvChunk[] = [];
	let recordStart = 0;
	let currentChunkStart: number | undefined;
	let currentChunkEnd = 0;
	let currentChunkRecords = 0;
	let inQuotes = false;
	let quotePending = false;
	let pendingCarriageReturn: number | undefined;
	let recordColumnCount = 1;
	let firstColumnCount: number | undefined;
	let inconsistentRecordCount = 0;
	let headerRange: { start: number; end: number } | undefined;
	let headerColumnCount: number | undefined;
	let totalRecords = 0;
	let firstBlock = true;

	function finishChunk() {
		if (currentChunkStart === undefined || !currentChunkRecords) return;
		chunks.push({
			index: chunks.length,
			byteStart: currentChunkStart,
			byteEnd: currentChunkEnd,
			recordCount: currentChunkRecords,
			payloadBytes: currentChunkEnd - currentChunkStart
		});
		currentChunkStart = undefined;
		currentChunkEnd = 0;
		currentChunkRecords = 0;
	}

	function finishRecord(recordEnd: number) {
		const recordBytes = recordEnd - recordStart;
		if (hasHeader && !headerRange) {
			if (recordBytes > maxPayloadBytes) {
				throw new Error(`The CSV header exceeds the ${formatBytes(maxPayloadBytes)} chunk limit.`);
			}
			headerRange = { start: recordStart, end: recordEnd };
			headerColumnCount = recordColumnCount;
			recordStart = recordEnd;
			recordColumnCount = 1;
			return;
		}

		if (recordBytes > maxPayloadBytes) {
			throw new Error(
				`CSV record ${totalRecords + 1} is ${formatBytes(recordBytes)}, exceeding the ${formatBytes(maxPayloadBytes)} chunk limit.`
			);
		}
		if (firstColumnCount === undefined) firstColumnCount = recordColumnCount;
		else if (recordColumnCount !== firstColumnCount) inconsistentRecordCount += 1;

		if (currentChunkStart === undefined) {
			currentChunkStart = recordStart;
		} else if (recordEnd - currentChunkStart > maxPayloadBytes) {
			finishChunk();
			currentChunkStart = recordStart;
		}
		currentChunkEnd = recordEnd;
		currentChunkRecords += 1;
		totalRecords += 1;
		recordStart = recordEnd;
		recordColumnCount = 1;
	}

	try {
		for (let offset = 0; offset < file.size; offset += blockSize) {
			throwIfAborted(signal);
			const bytes = new Uint8Array(
				await file.slice(offset, Math.min(offset + blockSize, file.size)).arrayBuffer()
			);
			utf8Decoder.decode(bytes, { stream: true });
			let index = 0;
			if (
				firstBlock &&
				bytes.length >= UTF8_BOM.length &&
				UTF8_BOM.every((byte, bomIndex) => bytes[bomIndex] === byte)
			) {
				index = UTF8_BOM.length;
				recordStart = UTF8_BOM.length;
			}
			firstBlock = false;

			for (; index < bytes.length; index += 1) {
				const byte = bytes[index];
				const position = offset + index;

				if (pendingCarriageReturn !== undefined) {
					if (byte === LINE_FEED) {
						finishRecord(position + 1);
						pendingCarriageReturn = undefined;
						continue;
					}
					finishRecord(pendingCarriageReturn + 1);
					pendingCarriageReturn = undefined;
				}

				if (inQuotes) {
					if (quotePending) {
						if (byte === DOUBLE_QUOTE) {
							quotePending = false;
							continue;
						}
						inQuotes = false;
						quotePending = false;
					} else if (byte === DOUBLE_QUOTE) {
						quotePending = true;
						continue;
					} else {
						continue;
					}
				}

				if (byte === DOUBLE_QUOTE) {
					inQuotes = true;
				} else if (byte === COMMA) {
					recordColumnCount += 1;
				} else if (byte === CARRIAGE_RETURN) {
					pendingCarriageReturn = position;
				} else if (byte === LINE_FEED) {
					finishRecord(position + 1);
				}
			}

			onProgress?.(Math.min(offset + bytes.length, file.size), file.size);
		}
		utf8Decoder.decode();
	} catch (error) {
		if (error instanceof TypeError) throw new Error('The selected file is not valid UTF-8 text.');
		throw error;
	}

	throwIfAborted(signal);
	if (inQuotes && !quotePending) throw new Error('The CSV file ends inside a quoted field.');
	if (pendingCarriageReturn !== undefined) {
		finishRecord(pendingCarriageReturn + 1);
		pendingCarriageReturn = undefined;
	} else if (recordStart < file.size) {
		finishRecord(file.size);
	}
	finishChunk();

	if (!totalRecords) {
		throw new Error(
			hasHeader
				? 'The CSV file contains a header but no data rows.'
				: 'The CSV file has no data rows.'
		);
	}

	const header = headerRange
		? new TextDecoder('utf-8', { fatal: true })
				.decode(await file.slice(headerRange.start, headerRange.end).arrayBuffer())
				.replace(/\r\n?$|\n$/, '')
		: undefined;

	return {
		fileBytes: file.size,
		dataBytes: chunks.reduce((total, chunk) => total + chunk.payloadBytes, 0),
		totalRecords,
		columnCount: firstColumnCount ?? 0,
		inconsistentRecordCount,
		header,
		headerColumnCount,
		chunks
	};
}

/** Reads one preflighted chunk and rejects non-UTF-8 content. */
export async function readInlineCsvChunk(file: Blob, chunk: InlineCsvChunk) {
	return new TextDecoder('utf-8', { fatal: true }).decode(
		await file.slice(chunk.byteStart, chunk.byteEnd).arrayBuffer()
	);
}

/** Creates a stable per-target content key used by Kusto ingest-by tags. */
export async function hashInlineCsvChunk(database: string, table: string, data: string) {
	const encoder = new TextEncoder();
	const target = encoder.encode(`${database}\0${table}\0`);
	const payload = encoder.encode(data);
	const combined = new Uint8Array(target.byteLength + payload.byteLength);
	combined.set(target);
	combined.set(payload, target.byteLength);
	const digest = await crypto.subtle.digest('SHA-256', combined);
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function formatBytes(bytes: number) {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}
