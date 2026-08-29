export type PreparedPlan<TPlan> = { plan: TPlan; error: '' } | { plan: undefined; error: string };

function errorMessage(error: unknown) {
	return error instanceof Error ? error.message : String(error);
}

/** Shared state machine for draft → review → confirmed mutation workflows. */
export function createReviewablePlan<TPlan>(buildPlan: () => TPlan) {
	const state = $state({ reviewing: false, confirmationText: '' });
	const prepared = $derived.by<PreparedPlan<TPlan>>(() => {
		try {
			return { plan: buildPlan(), error: '' };
		} catch (error) {
			return { plan: undefined, error: errorMessage(error) };
		}
	});

	function reset() {
		state.reviewing = false;
		state.confirmationText = '';
	}

	return {
		state,
		get prepared() {
			return prepared;
		},
		reset,
		startReview(canReview = true) {
			if (!prepared.plan || !canReview) return false;
			state.confirmationText = '';
			state.reviewing = true;
			return true;
		},
		returnToEditor(canEdit = true) {
			if (!canEdit) return false;
			state.confirmationText = '';
			state.reviewing = false;
			return true;
		},
		canSubmit(confirmationPhrase: string, canSubmit = true) {
			return Boolean(prepared.plan && canSubmit && state.confirmationText === confirmationPhrase);
		}
	};
}
