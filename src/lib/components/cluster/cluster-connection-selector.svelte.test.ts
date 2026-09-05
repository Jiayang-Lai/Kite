import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

import { AZURE_AUTHENTICATION_PROFILES_STORAGE_KEY } from '$lib/azure-auth/profile-store.svelte';
import type { KustoClusterConnection } from '$lib/kusto/query-client';
import AppContextWrapper from '../../../../tests/fixtures/app-context-wrapper.svelte';
import ClusterConnectionSelector from './cluster-connection-selector.svelte';

const mockCluster: KustoClusterConnection = {
	id: 'mock',
	name: 'Mock cluster',
	kind: 'mock',
	url: 'mock://kite',
	mockSchema: {},
	mockSchemaRevision: 0
};
const remoteCluster: KustoClusterConnection = {
	id: 'remote',
	name: 'Production',
	kind: 'remote',
	url: 'https://example.kusto.windows.net',
	description: 'Primary cluster'
};
const analyticsCluster: KustoClusterConnection = {
	id: 'analytics',
	name: 'Security workspace',
	kind: 'log-analytics',
	url: 'https://api.loganalytics.azure.com',
	logAnalytics: {
		workspaceId: '11111111-1111-4111-8111-111111111111',
		tenantId: 'contoso.onmicrosoft.com',
		clientId: '22222222-2222-4222-8222-222222222222',
		authenticationProfileId: 'profile-1'
	}
};

describe('ClusterConnectionSelector', () => {
	beforeEach(() => localStorage.clear());

	it('switches connections and exposes the add flow', async () => {
		const onclusterchange = vi.fn();
		const screen = await render(
			ClusterConnectionSelector,
			{
				clusters: [mockCluster, remoteCluster],
				selectedClusterId: 'mock',
				onclusterchange
			},
			{ wrapper: AppContextWrapper }
		);

		await screen.getByRole('button', { name: /Mock cluster/ }).click();
		await expect.element(screen.getByText('Primary cluster')).toBeVisible();
		await screen.getByRole('menuitem', { name: /Production/ }).click();
		expect(onclusterchange).toHaveBeenCalledWith('remote');

		await screen.getByRole('button', { name: /Mock cluster/ }).click();
		await screen.getByRole('menuitem', { name: 'Add cluster' }).click();
		await expect.element(screen.getByRole('heading', { name: 'Add cluster' })).toBeVisible();
	});

	it('shows locked and switching states', async () => {
		const screen = await render(
			ClusterConnectionSelector,
			{ clusters: [mockCluster], selectedClusterId: 'mock', locked: true },
			{ wrapper: AppContextWrapper }
		);

		await expect.element(screen.getByLabelText('Cluster selection locked')).toBeVisible();
		await expect.element(screen.getByRole('button', { name: /Mock cluster/ })).toBeDisabled();
		await screen.rerender({
			clusters: [mockCluster],
			selectedClusterId: 'mock',
			locked: false,
			switching: true
		});
		await expect.element(screen.getByLabelText('Switching connection')).toBeVisible();
		await expect.element(screen.getByText('Switching to Mock cluster…')).toBeVisible();
	});

	it('requires a replacement authentication profile when the saved one is missing', async () => {
		const screen = await render(
			ClusterConnectionSelector,
			{ clusters: [mockCluster, analyticsCluster], selectedClusterId: 'mock' },
			{ wrapper: AppContextWrapper }
		);

		await screen.getByRole('button', { name: /Mock cluster/ }).click();
		await screen.getByRole('menuitem', { name: /Security workspace/ }).click();
		await expect
			.element(screen.getByRole('heading', { name: 'Link authentication profile' }))
			.toBeVisible();
		await expect.element(screen.getByRole('button', { name: 'Link and continue' })).toBeDisabled();
		await screen.getByRole('button', { name: 'Cancel' }).click();
	});

	it('reports the selected authentication profile', async () => {
		localStorage.setItem(
			AZURE_AUTHENTICATION_PROFILES_STORAGE_KEY,
			JSON.stringify([
				{
					id: 'profile-1',
					name: 'Contoso',
					tenantId: 'contoso.onmicrosoft.com',
					clientId: '22222222-2222-4222-8222-222222222222',
					account: {
						homeAccountId: 'home',
						localAccountId: 'local',
						tenantId: 'tenant',
						username: 'analyst@contoso.com',
						name: 'Analyst'
					}
				}
			])
		);
		const screen = await render(
			ClusterConnectionSelector,
			{
				clusters: [analyticsCluster],
				selectedClusterId: 'analytics'
			},
			{ wrapper: AppContextWrapper }
		);

		await screen.getByRole('button', { name: /Security workspace/ }).click();
		await expect.element(screen.getByText('Using profile Contoso')).toBeVisible();
		await expect.element(screen.getByText(/Signed in as Analyst/)).toBeVisible();
	});

	it('links an available profile to a connection with a missing profile', async () => {
		localStorage.setItem(
			AZURE_AUTHENTICATION_PROFILES_STORAGE_KEY,
			JSON.stringify([
				{
					id: 'profile-1',
					name: 'Contoso',
					tenantId: 'contoso.onmicrosoft.com',
					clientId: '22222222-2222-4222-8222-222222222222'
				}
			])
		);
		const onlinkauthenticationprofile = vi.fn();
		const missingProfileCluster = {
			...analyticsCluster,
			logAnalytics: { ...analyticsCluster.logAnalytics!, authenticationProfileId: 'missing' }
		};
		const screen = await render(
			ClusterConnectionSelector,
			{
				clusters: [mockCluster, missingProfileCluster],
				selectedClusterId: 'mock',
				onlinkauthenticationprofile
			},
			{ wrapper: AppContextWrapper }
		);
		await screen.getByRole('button', { name: /Mock cluster/ }).click();
		await screen.getByRole('menuitem', { name: /Security workspace/ }).click();
		await expect
			.element(screen.getByRole('heading', { name: 'Link authentication profile' }))
			.toBeVisible();
		await screen.getByText('Choose an authentication profile', { exact: true }).click();
		await screen.getByRole('option', { name: 'Contoso' }).click();
		await screen.getByRole('button', { name: 'Link and continue' }).click();
		expect(onlinkauthenticationprofile).toHaveBeenCalledWith('analytics', 'profile-1');
	});
});
