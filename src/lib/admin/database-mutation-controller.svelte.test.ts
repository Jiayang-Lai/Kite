import { beforeEach, describe, expect, it, vi } from 'vitest';

const adapterMocks = vi.hoisted(() => ({
	createSchemaMutationAdapter: vi.fn()
}));

vi.mock('$lib/admin/schema-mutation-adapter', () => ({
	createSchemaMutationAdapter: adapterMocks.createSchemaMutationAdapter
}));

import type { KustoClusterConnection } from '$lib/cluster/connections';
import { createDatabaseMutationController } from './database-mutation-controller.svelte';

type AdapterOptions = {
	cluster: KustoClusterConnection;
	mockSchemaRevision: number;
	onexecution: (execution: { cancel: () => void }) => void;
	onstage?: (stage: 'table-created' | 'column-docstrings-applied') => void;
};

const cluster = { id: 'local', name: 'Local Kusto', kind: 'remote' } as KustoClusterConnection;

function createController() {
	const running: boolean[] = [];
	const store = { clusters: [cluster], updateMockSchema: vi.fn() };
	const controller = createDatabaseMutationController({
		store,
		onmutationstatechange: (state) => running.push(state)
	});
	return { controller, running, store };
}

/** Starts an execution through the adapter the controller built, as a mutation port would. */
function startExecution() {
	const options = adapterMocks.createSchemaMutationAdapter.mock.lastCall?.[0] as AdapterOptions;
	const cancel = vi.fn();
	options.onexecution({ cancel });
	return cancel;
}

beforeEach(() => {
	vi.clearAllMocks();
	adapterMocks.createSchemaMutationAdapter.mockReturnValue({});
});

describe('createDatabaseMutationController', () => {
	it('treats only the latest request as current', () => {
		const { controller, running } = createController();

		const first = controller.begin();
		const second = controller.begin();

		expect(controller.isCurrent(first)).toBe(false);
		expect(controller.isCurrent(second)).toBe(true);
		expect(running).toEqual([true, true]);
	});

	it('ignores a stale request finishing and keeps the newer one running', () => {
		const { controller, running } = createController();
		const stale = controller.begin();
		const current = controller.begin();
		controller.adapter('local', 0);
		const cancel = startExecution();

		expect(controller.finish(stale)).toBe(false);
		expect(running).toEqual([true, true]);

		controller.cancel();
		expect(cancel).toHaveBeenCalledOnce();
		expect(controller.finish(current)).toBe(true);
		expect(running).toEqual([true, true, false]);
	});

	it('cancels the running execution and does nothing once it has finished', () => {
		const { controller } = createController();
		const id = controller.begin();
		controller.adapter('local', 0);
		const cancel = startExecution();

		controller.cancel();
		expect(cancel).toHaveBeenCalledOnce();

		controller.finish(id);
		controller.cancel();
		expect(cancel).toHaveBeenCalledOnce();
	});

	it('builds the adapter for the requested cluster, mock revision and stage callback', () => {
		const { controller, store } = createController();
		const onstage = vi.fn();

		controller.adapter('local', 7, onstage);

		expect(adapterMocks.createSchemaMutationAdapter).toHaveBeenCalledWith(
			expect.objectContaining({
				cluster,
				mockSchemaStore: store,
				mockSchemaRevision: 7,
				onstage
			})
		);
	});

	it('refuses a cluster that was removed', () => {
		const { controller } = createController();

		expect(() => controller.adapter('removed', 0)).toThrow('This cluster no longer exists.');
		expect(adapterMocks.createSchemaMutationAdapter).not.toHaveBeenCalled();
	});

	it('invalidates and cancels the running request when disposed', () => {
		const { controller, running } = createController();
		const id = controller.begin();
		controller.adapter('local', 0);
		const cancel = startExecution();

		controller.dispose();

		expect(cancel).toHaveBeenCalledOnce();
		expect(controller.isCurrent(id)).toBe(false);
		expect(controller.finish(id)).toBe(false);
		expect(running).toEqual([true, false]);

		controller.cancel();
		expect(cancel).toHaveBeenCalledOnce();
	});
});
