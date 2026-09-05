import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

import AppContextWrapper from '../../../../tests/fixtures/app-context-wrapper.svelte';
import { AZURE_AUTHENTICATION_PROFILES_STORAGE_KEY } from '$lib/azure-auth/profile-store.svelte';
import AddClusterDialog from './add-cluster-dialog.svelte';

describe('AddClusterDialog', () => {
	beforeEach(() => localStorage.clear());

	it('submits and cancels a remote connection', async () => {
		const onsubmit = vi.fn();
		const oncancel = vi.fn();
		const screen = await render(
			AddClusterDialog,
			{ inline: true, onsubmit, oncancel },
			{ wrapper: AppContextWrapper }
		);

		await expect.element(screen.getByRole('button', { name: 'Add and connect' })).toBeDisabled();
		await screen.getByLabelText('Name').fill('Production');
		await screen.getByLabelText('Cluster URL').fill('https://example.kusto.windows.net');
		await screen.getByLabelText('Description (optional)').fill('Primary cluster');
		await screen.getByRole('button', { name: 'Add and connect' }).click();

		expect(onsubmit).toHaveBeenCalledWith({
			name: 'Production',
			kind: 'remote',
			url: 'https://example.kusto.windows.net',
			description: 'Primary cluster'
		});
		await screen.getByRole('button', { name: 'Cancel' }).click();
		expect(oncancel).toHaveBeenCalledOnce();
	});

	it('submits an emulated connection with memory storage', async () => {
		const onsubmit = vi.fn();
		const screen = await render(
			AddClusterDialog,
			{ inline: true, onsubmit },
			{ wrapper: AppContextWrapper }
		);

		await screen.getByLabelText('Name').fill('Local lab');
		await screen.getByLabelText('Kind').click();
		await screen.getByRole('option', { name: 'Emulated' }).click();
		await screen.getByLabelText('Data storage').click();
		await screen.getByRole('option', { name: 'Ephemeral memory' }).click();
		await screen.getByRole('button', { name: 'Add and connect' }).click();

		expect(onsubmit).toHaveBeenCalledWith({
			name: 'Local lab',
			kind: 'emulated',
			description: '',
			storageMode: 'memory'
		});
	});

	it('validates mock JSON and submits a normalized schema', async () => {
		const onsubmit = vi.fn();
		const screen = await render(
			AddClusterDialog,
			{ inline: true, onsubmit },
			{ wrapper: AppContextWrapper }
		);

		await screen.getByLabelText('Name').fill('Custom mock');
		await screen.getByLabelText('Kind').click();
		await screen.getByRole('option', { name: 'Mock' }).click();
		await screen.getByLabelText('Schema JSON').fill('{bad json');
		await screen.getByRole('button', { name: 'Add and connect' }).click();
		await expect.element(screen.getByRole('alert')).toHaveTextContent('Enter valid JSON');
		expect(onsubmit).not.toHaveBeenCalled();

		await screen
			.getByLabelText('Schema JSON')
			.fill(JSON.stringify({ Demo: { name: 'Demo', tables: [] } }));
		await screen.getByRole('button', { name: 'Add and connect' }).click();
		expect(onsubmit).toHaveBeenCalledWith(
			expect.objectContaining({ name: 'Custom mock', kind: 'mock' })
		);
	});

	it('renders an existing cluster as a fixed-kind edit form', async () => {
		const screen = await render(
			AddClusterDialog,
			{
				inline: true,
				cluster: {
					id: 'local',
					name: 'Local',
					kind: 'emulated',
					url: 'emulated://kite/local',
					description: 'Editable',
					emulatedStorage: { mode: 'memory' }
				}
			},
			{ wrapper: AppContextWrapper }
		);

		await expect.element(screen.getByLabelText('Kind')).toBeDisabled();
		await expect.element(screen.getByLabelText('Data storage')).toBeDisabled();
		await expect.element(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled();
		await expect.element(screen.getByText(/Storage mode is fixed after creation/)).toBeVisible();
	});

	it('requires an authentication profile for Log Analytics connections', async () => {
		const screen = await render(AddClusterDialog, { inline: true }, { wrapper: AppContextWrapper });

		await screen.getByLabelText('Name').fill('Workspace');
		await screen.getByLabelText('Kind').click();
		await screen.getByRole('option', { name: 'Azure Log Analytics' }).click();

		await expect
			.element(screen.getByRole('alert'))
			.toHaveTextContent('No Azure authentication profiles are available');
		await expect.element(screen.getByRole('button', { name: 'Add and connect' })).toBeDisabled();
	});

	it('submits a Log Analytics connection using the selected profile', async () => {
		localStorage.setItem(
			AZURE_AUTHENTICATION_PROFILES_STORAGE_KEY,
			JSON.stringify([
				{
					id: 'profile-1',
					name: 'Contoso identity',
					tenantId: 'tenant-1',
					clientId: 'client-1'
				}
			])
		);
		const onsubmit = vi.fn();
		const screen = await render(
			AddClusterDialog,
			{ inline: true, onsubmit },
			{ wrapper: AppContextWrapper }
		);

		await screen.getByLabelText('Name').fill('Operations workspace');
		await screen.getByLabelText('Kind').click();
		await screen.getByRole('option', { name: 'Azure Log Analytics' }).click();
		await screen.getByLabelText('Azure authentication profile').click();
		await screen.getByRole('option', { name: 'Contoso identity' }).click();
		await screen.getByLabelText('Workspace ID').fill('workspace-1');
		await screen
			.getByLabelText('Workspace resource ID')
			.fill('/subscriptions/sub/resourceGroups/rg/providers/workspaces/operations');
		await screen.getByLabelText(/Default timespan/).fill('PT12H');
		await screen.getByLabelText(/Description/).fill('Operational logs');
		await screen.getByRole('button', { name: 'Add and connect' }).click();

		expect(onsubmit).toHaveBeenCalledWith({
			name: 'Operations workspace',
			kind: 'log-analytics',
			description: 'Operational logs',
			workspaceId: 'workspace-1',
			workspaceResourceId: '/subscriptions/sub/resourceGroups/rg/providers/workspaces/operations',
			tenantId: 'tenant-1',
			clientId: 'client-1',
			authenticationProfileId: 'profile-1',
			defaultTimespan: 'PT12H'
		});
	});
});
