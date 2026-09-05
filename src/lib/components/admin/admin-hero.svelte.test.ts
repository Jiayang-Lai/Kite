import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';

import type { ConnectionCapabilities } from '$lib/cluster/connection-capabilities';
import AdminHero from './admin-hero.svelte';

const unavailableCapabilities: ConnectionCapabilities = {
	schemaLoader: 'mock',
	queryExecutor: 'none',
	managementCommands: false,
	databases: { create: false, drop: false, rename: false },
	ingestion: 'none'
};

const emulatedCapabilities: ConnectionCapabilities = {
	schemaLoader: 'emulated',
	queryExecutor: 'emulated',
	managementCommands: false,
	databases: { create: true, drop: true, rename: 'canonical' },
	ingestion: 'emulated'
};

const remoteCapabilities: ConnectionCapabilities = {
	schemaLoader: 'backend',
	queryExecutor: 'kusto',
	managementCommands: true,
	databases: { create: true, drop: true, rename: 'display-name' },
	ingestion: 'kustainer'
};

describe('AdminHero', () => {
	it('describes connection failures and unavailable capabilities', async () => {
		const screen = await render(AdminHero, {
			clusterName: 'Offline',
			databaseCount: 0,
			tableCount: 0,
			connectionStatus: 'error',
			capabilities: unavailableCapabilities
		});

		await expect.element(screen.getByText('Cluster connection needs attention')).toBeVisible();
		await expect
			.element(screen.getByText('Kite could not load the current cluster schema.'))
			.toBeVisible();
		await expect.element(screen.getByText('Read only')).toBeVisible();
		await expect.element(screen.getByText('Inspect schema')).toBeVisible();

		await screen.rerender({
			clusterName: 'Offline',
			databaseCount: 0,
			tableCount: 0,
			connectionStatus: 'error',
			connectionError: 'The endpoint refused the request.',
			capabilities: unavailableCapabilities
		});
		await expect.element(screen.getByText('The endpoint refused the request.')).toBeVisible();
	});

	it('moves through loading, emulated, and remote-ready states', async () => {
		const screen = await render(AdminHero, {
			clusterName: 'Loading',
			databaseCount: 1,
			tableCount: 2,
			connectionStatus: 'loading',
			capabilities: unavailableCapabilities
		});

		await expect.element(screen.getByText('Loading cluster state')).toBeVisible();

		await screen.rerender({
			clusterName: 'Local',
			databaseCount: 2,
			tableCount: 5,
			connectionStatus: 'ready',
			capabilities: emulatedCapabilities,
			emulatedStorage: { mode: 'memory' }
		});
		await expect.element(screen.getByText('Ephemeral')).toBeVisible();
		await expect.element(screen.getByText('Browser emulation')).toBeVisible();
		await expect.element(screen.getByText('Ingest data')).toBeVisible();

		await screen.rerender({
			clusterName: 'Production',
			databaseCount: 3,
			tableCount: 8,
			connectionStatus: 'ready',
			capabilities: remoteCapabilities,
			emulatedStorage: { mode: 'opfs', storageId: 'production', formatVersion: 1 }
		});
		await expect.element(screen.getByText('Persistent')).toBeVisible();
		await expect.element(screen.getByText('Kustainer')).toBeVisible();
		await expect.element(screen.getByText('Run a management command')).toBeVisible();
		await expect.element(screen.getByRole('link', { name: 'Management commands' })).toBeVisible();
	});
});
