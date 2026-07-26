import { describe, expect, it } from 'vitest';

import {
	hashInlineCsvChunk,
	planInlineCsvFile,
	readInlineCsvChunk,
	type InlineCsvPlanOptions
} from './inline-file';

const DEFAULT_OPTIONS: InlineCsvPlanOptions = {
	maxFileBytes: 1024 * 1024,
	maxPayloadBytes: 24,
	readBlockBytes: 5
};

describe('inline CSV file planning', () => {
	it('chunks only at complete LF records', async () => {
		const file = new Blob(['one,1\ntwo,2\nthree,3\n']);
		const plan = await planInlineCsvFile(file, { ...DEFAULT_OPTIONS, maxPayloadBytes: 12 });

		expect(plan.totalRecords).toBe(3);
		expect(plan.columnCount).toBe(2);
		expect(plan.chunks.map((chunk) => chunk.recordCount)).toEqual([2, 1]);
		expect(await readInlineCsvChunk(file, plan.chunks[0])).toBe('one,1\ntwo,2\n');
		expect(await readInlineCsvChunk(file, plan.chunks[1])).toBe('three,3\n');
	});

	it('keeps CRLF and quoted newlines inside their records', async () => {
		const csv = '1,"hello\r\nworld",3\r\n2,"fine",4\r\n';
		const file = new Blob([csv]);
		const plan = await planInlineCsvFile(file, { ...DEFAULT_OPTIONS, maxPayloadBytes: 23 });

		expect(plan.totalRecords).toBe(2);
		expect(plan.columnCount).toBe(3);
		expect(plan.chunks).toHaveLength(2);
		expect(await readInlineCsvChunk(file, plan.chunks[0])).toBe('1,"hello\r\nworld",3\r\n');
	});

	it('handles escaped quotes split across scan blocks', async () => {
		const csv = '1,"a ""quoted"" value",2\n3,plain,4';
		const file = new Blob([csv]);
		const plan = await planInlineCsvFile(file, {
			...DEFAULT_OPTIONS,
			maxPayloadBytes: 64,
			readBlockBytes: 1
		});

		expect(plan.totalRecords).toBe(2);
		expect(plan.inconsistentRecordCount).toBe(0);
		expect(await readInlineCsvChunk(file, plan.chunks[0])).toBe(csv);
	});

	it('removes a UTF-8 BOM and skips one header record', async () => {
		const file = new Blob([new Uint8Array([0xef, 0xbb, 0xbf]), 'name,value\nα,1\nβ,2\n']);
		const plan = await planInlineCsvFile(file, {
			...DEFAULT_OPTIONS,
			hasHeader: true,
			maxPayloadBytes: 64
		});

		expect(plan.header).toBe('name,value');
		expect(plan.headerColumnCount).toBe(2);
		expect(plan.totalRecords).toBe(2);
		expect(await readInlineCsvChunk(file, plan.chunks[0])).toBe('α,1\nβ,2\n');
	});

	it('reports inconsistent column counts', async () => {
		const plan = await planInlineCsvFile(new Blob(['a,b\n1,2,3\n4,5\n']), {
			...DEFAULT_OPTIONS,
			hasHeader: true,
			maxPayloadBytes: 64
		});

		expect(plan.columnCount).toBe(3);
		expect(plan.inconsistentRecordCount).toBe(1);
	});

	it('rejects an unterminated quoted field before producing a plan', async () => {
		await expect(
			planInlineCsvFile(new Blob(['1,"never closed\n2,value']), DEFAULT_OPTIONS)
		).rejects.toThrow('ends inside a quoted field');
	});

	it('rejects a single record larger than the payload budget', async () => {
		await expect(
			planInlineCsvFile(new Blob(['a,record,that,is,too,large\n']), {
				...DEFAULT_OPTIONS,
				maxPayloadBytes: 10
			})
		).rejects.toThrow('CSV record 1');
	});

	it('rejects invalid UTF-8 and files over the configured limit', async () => {
		await expect(
			planInlineCsvFile(new Blob([new Uint8Array([0xc3, 0x28])]), DEFAULT_OPTIONS)
		).rejects.toThrow('not valid UTF-8');
		await expect(
			planInlineCsvFile(new Blob(['1234']), { ...DEFAULT_OPTIONS, maxFileBytes: 3 })
		).rejects.toThrow('inline files are limited');
	});

	it('creates stable target-specific content hashes', async () => {
		const first = await hashInlineCsvChunk('db', 'table', 'one,1\n');
		const same = await hashInlineCsvChunk('db', 'table', 'one,1\n');
		const other = await hashInlineCsvChunk('db', 'other', 'one,1\n');

		expect(first).toMatch(/^[a-f0-9]{64}$/);
		expect(same).toBe(first);
		expect(other).not.toBe(first);
	});
});
