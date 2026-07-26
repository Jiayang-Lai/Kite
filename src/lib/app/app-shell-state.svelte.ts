import { getContext, setContext } from 'svelte';

const APP_SHELL_STATE = Symbol('app-shell-state');

export type AppShellState = {
	sidebarOpen: boolean;
};

/** Creates app-shell UI state that remains mounted across sibling workspace routes. */
export function createAppShellState(): AppShellState {
	let sidebarOpen = $state(true);

	return {
		get sidebarOpen() {
			return sidebarOpen;
		},
		set sidebarOpen(value: boolean) {
			sidebarOpen = value;
		}
	};
}

export function setAppShellState(state: AppShellState) {
	setContext(APP_SHELL_STATE, state);
}

export function getAppShellState(): AppShellState {
	const state = getContext<AppShellState>(APP_SHELL_STATE);
	if (!state) throw new Error('App shell state has not been initialized.');
	return state;
}
