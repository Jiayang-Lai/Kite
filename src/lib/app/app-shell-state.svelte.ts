import { getContext, setContext } from 'svelte';

import { SIDEBAR_COOKIE_NAME } from '$lib/components/ui/sidebar/constants';

const APP_SHELL_STATE = Symbol('app-shell-state');

export type AppShellState = {
	sidebarOpen: boolean;
};

/**
 * Reads the sidebar preference written by the sidebar provider. Routes are prerendered,
 * so this must run in the browser rather than in a server load.
 */
export function getPersistedSidebarOpen() {
	if (typeof document === 'undefined') return true;
	return !document.cookie.split('; ').includes(`${SIDEBAR_COOKIE_NAME}=false`);
}

/** Creates app-shell UI state that remains mounted across sibling workspace routes. */
export function createAppShellState(
	getInitialSidebarOpen: () => boolean = getPersistedSidebarOpen
): AppShellState {
	let sidebarOpen = $state(getInitialSidebarOpen());

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
