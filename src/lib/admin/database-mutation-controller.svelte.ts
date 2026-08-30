import type { ClusterConnectionStore } from '$lib/cluster/cluster-connection-store.svelte';
import { createSchemaMutationAdapter } from '$lib/admin/schema-mutation-adapter';

type DatabaseMutationControllerOptions = {
	store: Pick<ClusterConnectionStore, 'clusters' | 'updateMockSchema'>;
	onmutationstatechange?: (running: boolean) => void;
};

/**
 * Owns request identity, cancellation, and connection-specific mutation adapters.
 * Dialog components retain presentation state while this controller owns transport state.
 */
export function createDatabaseMutationController(options: DatabaseMutationControllerOptions) {
	let requestId = 0;
	let activeCancel: (() => void) | undefined;

	function begin() {
		requestId += 1;
		options.onmutationstatechange?.(true);
		return requestId;
	}

	function isCurrent(id: number) {
		return id === requestId;
	}

	function finish(id: number) {
		if (!isCurrent(id)) return false;
		activeCancel = undefined;
		options.onmutationstatechange?.(false);
		return true;
	}

	function adapter(
		clusterId: string,
		mockSchemaRevision: number,
		onstage?: (stage: 'table-created' | 'column-docstrings-applied') => void
	) {
		const cluster = options.store.clusters.find((candidate) => candidate.id === clusterId);
		if (!cluster) throw new Error('This cluster no longer exists.');
		return createSchemaMutationAdapter({
			cluster,
			mockSchemaStore: options.store,
			mockSchemaRevision,
			onexecution: (execution) => {
				activeCancel = execution.cancel;
			},
			onstage
		});
	}

	return {
		begin,
		isCurrent,
		finish,
		adapter,
		cancel() {
			activeCancel?.();
		},
		dispose() {
			requestId += 1;
			activeCancel?.();
			activeCancel = undefined;
			options.onmutationstatechange?.(false);
		}
	};
}
