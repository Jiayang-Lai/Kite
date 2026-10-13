export type ConfirmationRequest = {
	title: string;
	description: string;
	actionLabel: string;
	variant?: 'default' | 'destructive';
};

/** Asks the user to confirm an action; resolves `false` when they cancel. */
export type ConfirmAction = (request: ConfirmationRequest) => Promise<boolean>;

/**
 * Promise-based confirmation backed by an in-app dialog, so controllers can ask for
 * confirmation without depending on `window.confirm` or any UI component.
 * Render `ConfirmationPromptDialog` with the returned prompt to display requests.
 */
export function createConfirmationPrompt() {
	let pending = $state<{ request: ConfirmationRequest; resolve: (confirmed: boolean) => void }>();

	function respond(confirmed: boolean) {
		const current = pending;
		pending = undefined;
		current?.resolve(confirmed);
	}

	return {
		get request() {
			return pending?.request;
		},
		ask(request: ConfirmationRequest) {
			// Only one confirmation is visible at a time; a newer request cancels the older one.
			respond(false);
			return new Promise<boolean>((resolve) => {
				pending = { request, resolve };
			});
		},
		respond
	};
}

export type ConfirmationPrompt = ReturnType<typeof createConfirmationPrompt>;
