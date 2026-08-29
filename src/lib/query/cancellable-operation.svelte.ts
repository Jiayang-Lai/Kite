import type { CancellableExecution } from '$lib/types/query-result';

export type CancellableOperationContext = {
	/** Whether this operation is still the latest one owned by its caller. */
	isCurrent: () => boolean;
	/** Registers the execution that should be cancelled by `cancel` or `dispose`. */
	setExecution: (execution?: CancellableExecution<unknown>) => void;
};

type OperationHandlers<T> = {
	onSuccess?: (value: T, context: CancellableOperationContext) => void | Promise<void>;
	onError?: (error: unknown, context: CancellableOperationContext) => void | Promise<void>;
};

/**
 * Owns one cancellable UI operation, suppressing stale results after replacement
 * or component teardown. The caller retains control of its result and error state.
 */
export function createCancellableOperation() {
	let operationId = 0;
	let activeExecution: CancellableExecution<unknown> | undefined;
	let isRunning = $state(false);

	async function run<T>(
		task: (context: CancellableOperationContext) => Promise<T>,
		handlers: OperationHandlers<T> = {}
	) {
		const currentId = ++operationId;
		isRunning = true;
		const context: CancellableOperationContext = {
			isCurrent: () => currentId === operationId,
			setExecution: (execution) => {
				if (currentId === operationId) activeExecution = execution;
			}
		};

		try {
			const value = await task(context);
			if (context.isCurrent()) await handlers.onSuccess?.(value, context);
		} catch (error) {
			if (context.isCurrent()) await handlers.onError?.(error, context);
		} finally {
			if (context.isCurrent()) {
				activeExecution = undefined;
				isRunning = false;
			}
		}
	}

	return {
		get isRunning() {
			return isRunning;
		},
		run,
		cancel() {
			activeExecution?.cancel();
		},
		/** Cancels the current execution and ignores any completion that arrives afterwards. */
		cancelAndInvalidate() {
			operationId += 1;
			activeExecution?.cancel();
			activeExecution = undefined;
			isRunning = false;
		},
		dispose() {
			this.cancelAndInvalidate();
		}
	};
}
