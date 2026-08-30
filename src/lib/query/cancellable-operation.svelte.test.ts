import { describe, expect, it, vi } from 'vitest';

import { createCancellableOperation } from './cancellable-operation.svelte';

describe('createCancellableOperation', () => {
	it('exposes running state and cancels the registered execution', async () => {
		let resolve!: (value: string) => void;
		const promise = new Promise<string>((nextResolve) => {
			resolve = nextResolve;
		});
		const cancel = vi.fn();
		const operation = createCancellableOperation();
		const run = operation.run((context) => {
			context.setExecution({ promise, cancel });
			return promise;
		});

		expect(operation.isRunning).toBe(true);
		operation.cancel();
		expect(cancel).toHaveBeenCalledOnce();
		resolve('done');
		await run;
		expect(operation.isRunning).toBe(false);
	});

	it('suppresses callbacks after disposal', async () => {
		let resolve!: (value: string) => void;
		const promise = new Promise<string>((nextResolve) => {
			resolve = nextResolve;
		});
		const onSuccess = vi.fn();
		const operation = createCancellableOperation();
		const run = operation.run(() => promise, { onSuccess });

		operation.dispose();
		resolve('stale');
		await run;
		expect(onSuccess).not.toHaveBeenCalled();
	});

	it('suppresses callbacks after cancellation is invalidated', async () => {
		let resolve!: (value: string) => void;
		const promise = new Promise<string>((nextResolve) => {
			resolve = nextResolve;
		});
		const cancel = vi.fn();
		const onSuccess = vi.fn();
		const operation = createCancellableOperation();
		const run = operation.run(
			(context) => {
				context.setExecution({ promise, cancel });
				return promise;
			},
			{ onSuccess }
		);

		operation.cancelAndInvalidate();
		resolve('stale');
		await run;

		expect(cancel).toHaveBeenCalledOnce();
		expect(onSuccess).not.toHaveBeenCalled();
		expect(operation.isRunning).toBe(false);
	});
});
