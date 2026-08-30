import { describe, expect, it } from 'vitest';

import { createAsyncDialogAction } from './async-dialog-action.svelte';

describe('createAsyncDialogAction', () => {
	it('tracks pending state, reports errors, and clears them before a retry', async () => {
		const action = createAsyncDialogAction();
		expect(await action.submit(() => Promise.reject(new Error('Unable to remove.')))).toBe(false);
		expect(action.state).toEqual({ error: 'Unable to remove.', isSubmitting: false });
		expect(await action.submit(() => undefined)).toBe(true);
		expect(action.state).toEqual({ error: '', isSubmitting: false });
	});
});
