import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

import { AZURE_AUTHENTICATION_PROFILES_STORAGE_KEY } from '$lib/azure-auth/profile-store.svelte';
import AppContextWrapper from '../../../../tests/fixtures/app-context-wrapper.svelte';
import AppSettingsMenu from './app-settings-menu.svelte';

const { signIn, clearAccountCache, signOutEverywhere, stopWaitingForSignOut } = vi.hoisted(() => ({
	signIn: vi.fn(),
	clearAccountCache: vi.fn(),
	signOutEverywhere: vi.fn(),
	stopWaitingForSignOut: vi.fn()
}));

vi.mock('$lib/azure-auth/msal-client-manager', () => ({
	azureMsalClientManager: {
		signIn,
		clearAccountCache,
		signOutEverywhere,
		stopWaitingForSignOut,
		toBinding: (account: unknown) => account
	}
}));

async function openProfiles(screen: Awaited<ReturnType<typeof render>>) {
	await screen.getByRole('button', { name: /Settings/ }).click();
	await screen.getByRole('menuitem', { name: 'Azure authentication profiles' }).click();
}

describe('AppSettingsMenu', () => {
	beforeEach(() => {
		localStorage.clear();
		signIn.mockReset();
		clearAccountCache.mockReset();
		signOutEverywhere.mockReset();
		stopWaitingForSignOut.mockReset();
	});

	it('creates and removes an authentication profile', async () => {
		const screen = await render(AppSettingsMenu, {}, { wrapper: AppContextWrapper });
		await openProfiles(screen);
		await expect
			.element(screen.getByText('No Azure authentication profiles have been created.'))
			.toBeVisible();
		await screen.getByRole('button', { name: 'New profile' }).click();
		const create = screen.getByRole('button', { name: 'Create profile' });
		await expect.element(create).toBeDisabled();
		await screen.getByPlaceholder('Session name').fill('Production');
		await screen.getByPlaceholder('Tenant ID or domain').fill('contoso.onmicrosoft.com');
		await screen
			.getByPlaceholder('Application (client) ID')
			.fill('22222222-2222-4222-8222-222222222222');
		await create.click();
		await expect.element(screen.getByText('Production')).toBeVisible();
		await expect.element(screen.getByLabelText('Sign in required')).toBeVisible();

		await screen.getByRole('button', { name: 'Remove Production' }).click();
		await screen.getByRole('button', { name: 'Cancel' }).click();
		await expect.element(screen.getByText('Production')).toBeVisible();
		await screen.getByRole('button', { name: 'Remove Production' }).click();
		await screen.getByRole('button', { name: 'Remove profile only' }).click();
		await expect
			.element(screen.getByText('No Azure authentication profiles have been created.'))
			.toBeVisible();
	});

	it('shows a sign-in failure without losing the profile', async () => {
		localStorage.setItem(
			AZURE_AUTHENTICATION_PROFILES_STORAGE_KEY,
			JSON.stringify([
				{
					id: 'profile-1',
					name: 'Contoso',
					tenantId: 'contoso.com',
					clientId: 'client-1'
				}
			])
		);
		signIn.mockRejectedValueOnce(new Error('Popup blocked'));
		const screen = await render(AppSettingsMenu, {}, { wrapper: AppContextWrapper });
		await openProfiles(screen);
		await screen.getByRole('button', { name: 'Sign in' }).click();
		await expect.element(screen.getByRole('alert')).toHaveTextContent('Popup blocked');
		await expect.element(screen.getByText('Contoso', { exact: true })).toBeVisible();
	});
});
