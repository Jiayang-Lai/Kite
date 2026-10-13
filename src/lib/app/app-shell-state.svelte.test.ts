import { afterEach, describe, expect, it } from 'vitest';

import { SIDEBAR_COOKIE_NAME } from '$lib/components/ui/sidebar/constants';
import { getPersistedSidebarOpen } from './app-shell-state.svelte';

describe('app shell sidebar preference', () => {
	afterEach(() => {
		document.cookie = `${SIDEBAR_COOKIE_NAME}=; path=/; max-age=0`;
	});

	it('defaults to open without a stored preference', () => {
		expect(getPersistedSidebarOpen()).toBe(true);
	});

	it('restores a collapsed sidebar from the browser cookie', () => {
		document.cookie = `${SIDEBAR_COOKIE_NAME}=false; path=/`;
		expect(getPersistedSidebarOpen()).toBe(false);
		document.cookie = `${SIDEBAR_COOKIE_NAME}=true; path=/`;
		expect(getPersistedSidebarOpen()).toBe(true);
	});
});
