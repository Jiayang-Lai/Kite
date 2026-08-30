import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createRecentQueryStore, type RecentQuery } from './recent-query-store.svelte';
import { createSavedQueryStore, type SavedQuery } from './saved-query-store.svelte';

const RECENT_STORAGE_KEY = 'kite:recent-queries:v1';
const SAVED_STORAGE_KEY = 'kite:saved-queries:v1';

function recent(id: string, clusterId = 'cluster'): RecentQuery {
	return {
		id,
		clusterId,
		database: 'Samples',
		name: id,
		query: `print Value = "${id}"`,
		executedAt: `2026-01-0${id.length}T00:00:00.000Z`
	};
}

function saved(id: string, updatedAt: string, clusterId = 'cluster'): SavedQuery {
	return {
		id,
		clusterId,
		database: 'Samples',
		name: id,
		query: `print Value = "${id}"`,
		createdAt: '2026-01-01T00:00:00.000Z',
		updatedAt
	};
}

beforeEach(() => {
	localStorage.clear();
	vi.useFakeTimers();
	vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.useRealTimers();
});

describe('recent query browser persistence', () => {
	it('hydrates valid history only and caps it at three entries', () => {
		localStorage.setItem(
			RECENT_STORAGE_KEY,
			JSON.stringify([
				recent('one'),
				{ id: 'invalid' },
				recent('two'),
				recent('three'),
				recent('four')
			])
		);
		const store = createRecentQueryStore();

		store.hydrate();

		expect(store.queries.map((query) => query.id)).toEqual(['one', 'two', 'three']);
	});

	it('deduplicates repeated queries, keeps their id, and persists the newest three', () => {
		const store = createRecentQueryStore();
		const first = store.record({
			clusterId: 'cluster',
			database: 'Samples',
			name: 'First',
			query: 'print Value = 1'
		});
		store.record({
			clusterId: 'cluster',
			database: 'Samples',
			name: 'Second',
			query: 'print Value = 2'
		});
		store.record({
			clusterId: 'other',
			database: 'Samples',
			name: 'Other',
			query: 'print Value = 3'
		});
		vi.setSystemTime(new Date('2026-01-02T00:00:00.000Z'));
		const repeated = store.record({
			clusterId: 'cluster',
			database: 'Samples',
			name: 'First again',
			query: 'print Value = 1'
		});
		store.record({
			clusterId: 'cluster',
			database: 'Samples',
			name: 'Fourth',
			query: 'print Value = 4'
		});

		expect(repeated.id).toBe(first.id);
		expect(store.queries.map((query) => query.name)).toEqual(['Fourth', 'First again', 'Other']);
		expect(store.forCluster('cluster')).toHaveLength(2);
		expect(JSON.parse(localStorage.getItem(RECENT_STORAGE_KEY) ?? '[]')).toHaveLength(3);
	});
});

describe('saved query browser persistence', () => {
	it('hydrates valid queries, reports discarded records, and sorts per cluster', () => {
		localStorage.setItem(
			SAVED_STORAGE_KEY,
			JSON.stringify([
				saved('older', '2026-01-01T00:00:00.000Z'),
				{ id: 'invalid' },
				saved('newer', '2026-01-03T00:00:00.000Z'),
				saved('other', '2026-01-04T00:00:00.000Z', 'other-cluster')
			])
		);
		const store = createSavedQueryStore();

		store.hydrate();

		expect(store.storageError).toBe('Some invalid saved queries were ignored.');
		expect(store.forCluster('cluster').map((query) => query.id)).toEqual(['newer', 'older']);
	});

	it('reports malformed storage without preventing later saves', () => {
		localStorage.setItem(SAVED_STORAGE_KEY, '{not valid JSON');
		const store = createSavedQueryStore();
		store.hydrate();

		expect(store.storageError).toBe('Saved queries could not be loaded from local storage.');
		const created = store.save({
			clusterId: 'cluster',
			database: 'Samples',
			name: '  Saved name  ',
			query: '  print Value = 1  '
		});

		expect(created).toMatchObject({ name: 'Saved name', query: 'print Value = 1' });
		expect(store.storageError).toBeUndefined();
	});

	it('updates and removes saved queries while preserving creation metadata', () => {
		const store = createSavedQueryStore();
		const created = store.save({
			clusterId: 'cluster',
			database: 'Samples',
			name: 'Original',
			query: 'print Value = 1'
		});
		vi.setSystemTime(new Date('2026-01-02T00:00:00.000Z'));
		const updated = store.update(created.id, {
			clusterId: 'cluster',
			database: 'Analytics',
			name: '  Updated  ',
			query: '  print Value = 2  '
		});

		expect(updated).toMatchObject({
			id: created.id,
			createdAt: created.createdAt,
			updatedAt: '2026-01-02T00:00:00.000Z',
			name: 'Updated',
			query: 'print Value = 2'
		});
		expect(store.update('missing', { ...created, name: 'Missing' })).toBeUndefined();

		store.remove(created.id);
		expect(store.queries).toEqual([]);
	});

	it('surfaces browser write failures without losing in-memory edits', () => {
		vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
			throw new DOMException('Quota exceeded', 'QuotaExceededError');
		});
		const store = createSavedQueryStore();

		const created = store.save({
			clusterId: 'cluster',
			database: 'Samples',
			name: 'In memory',
			query: 'print Value = 1'
		});

		expect(store.queries).toEqual([created]);
		expect(store.storageError).toBe('Saved queries could not be stored locally.');
	});
});
