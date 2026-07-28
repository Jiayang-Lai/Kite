import { afterEach, describe, expect, it } from 'vitest';

import {
	checkpointDuckDb,
	createDuckDbDatabase,
	deletePersistentDuckDbStorage,
	disposeDuckDb,
	executeDuckDbSql
} from './query-client';
import {
	createEmulatedStorage,
	registerEmulatedStorage,
	unregisterEmulatedStorage
} from '$lib/emulated/storage';
import { loadEmulatedSchema } from '$lib/emulated/emulated-cluster';

const sessions = new Map<string, string>();

function createPersistentTestSession() {
	const sessionId = `persistent-test-${crypto.randomUUID()}`;
	const storageId = `persistent-storage-${crypto.randomUUID()}`;
	registerEmulatedStorage(sessionId, createEmulatedStorage('opfs', storageId));
	sessions.set(sessionId, storageId);
	return { sessionId, storageId };
}

async function runStage<T>(name: string, task: () => Promise<T>) {
	try {
		return await task();
	} catch (cause) {
		throw new Error(`${name}: ${cause instanceof Error ? cause.message : String(cause)}`, {
			cause
		});
	}
}

afterEach(async () => {
	for (const [sessionId, storageId] of sessions) {
		await disposeDuckDb(sessionId);
		await deletePersistentDuckDbStorage(storageId);
		unregisterEmulatedStorage(sessionId);
	}
	sessions.clear();
});

describe('DuckDB OPFS persistence', () => {
	it('reopens logical databases, tables, and rows after disposing the WASM worker', async () => {
		const { sessionId } = createPersistentTestSession();
		await runStage('create logical database', () => createDuckDbDatabase(sessionId, 'Analytics'));
		await runStage('create table', () =>
			executeDuckDbSql(
				'CREATE TABLE "Analytics".main."Events" (State VARCHAR, Count INTEGER)',
				sessionId
			)
		);
		await runStage('populate table', () =>
			executeDuckDbSql(
				`INSERT INTO "Analytics".main."Events" VALUES ('Texas', 12), ('Ohio', 8)`,
				sessionId
			)
		);
		await runStage('checkpoint populated table', () => checkpointDuckDb(sessionId));
		await runStage('dispose first worker', () => disposeDuckDb(sessionId));

		const schema = await runStage('reload schema', () => loadEmulatedSchema(sessionId));
		const result = await runStage('query restored table', () =>
			executeDuckDbSql(
				`SELECT CAST(COUNT(*) AS INTEGER) AS row_count
				 FROM "Analytics".main."Events"`,
				sessionId
			)
		);

		expect(Object.keys(schema).sort()).toEqual(['Analytics', 'memory']);
		expect(schema.Analytics.tables.map((table) => table.name)).toEqual(['Events']);
		expect(result.rows).toEqual([[2]]);
	}, 30_000);

	it('prevents a second session from writing the same persistent cluster', async () => {
		const storageId = `shared-storage-${crypto.randomUUID()}`;
		const firstSessionId = `first-${crypto.randomUUID()}`;
		const secondSessionId = `second-${crypto.randomUUID()}`;
		const storage = createEmulatedStorage('opfs', storageId);
		registerEmulatedStorage(firstSessionId, storage);
		registerEmulatedStorage(secondSessionId, storage);
		sessions.set(firstSessionId, storageId);
		sessions.set(secondSessionId, storageId);

		await executeDuckDbSql('SELECT 1', firstSessionId);

		await expect(executeDuckDbSql('SELECT 1', secondSessionId)).rejects.toThrow(
			'already open in another browser tab'
		);
	}, 30_000);
});
