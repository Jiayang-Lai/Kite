function errorMessage(error: unknown) {
	return error instanceof Error ? error.message : String(error);
}

/** Shared pending/error lifecycle for dialog actions that perform async mutations. */
export function createAsyncDialogAction() {
	const state = $state({ error: '', isSubmitting: false });

	return {
		state,
		reset() {
			state.error = '';
		},
		async submit(task: () => void | Promise<void>) {
			if (state.isSubmitting) return false;
			state.error = '';
			state.isSubmitting = true;
			try {
				await task();
				return true;
			} catch (error) {
				state.error = errorMessage(error);
				return false;
			} finally {
				state.isSubmitting = false;
			}
		}
	};
}
