import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

import DataIngestionWorkspace from './data-ingestion-workspace.svelte';

describe('DataIngestionWorkspace', () => {
	it('renders the unavailable state for a connection without ingestion support', async () => {
		const screen = await render(DataIngestionWorkspace, {
			selectedDatabase: '',
			clusterId: 'mock',
			clusterUrl: 'mock://kite',
			clusterName: 'Mock cluster',
			isMockCluster: true
		});

		await expect
			.element(screen.getByText('Data ingestion needs a configured Kustainer connection'))
			.toBeVisible();
		await expect
			.element(screen.getByText('Cluster type of mock does not support ingestion.'))
			.toBeVisible();
	});

	it('renders database and source controls for an emulated cluster', async () => {
		const container = document.body.appendChild(document.createElement('div'));
		container.className = 'h-screen';
		const screen = await render(DataIngestionWorkspace, {
			databases: {
				Analytics: {
					name: 'Analytics',
					tables: [{ name: 'Events', columns: [{ name: 'Message', type: 'string' }] }]
				}
			},
			selectedDatabase: 'Analytics',
			selectedTable: 'Events',
			clusterId: 'emulated',
			clusterUrl: 'emulated://kite',
			clusterName: 'Emulated cluster',
			emulatedStorage: { mode: 'memory' },
			isEmulatedCluster: true,
			ingestionEnabled: true
		}, { container });

		await expect.element(screen.getByText('Ingest into an existing table')).toBeVisible();
		await expect.element(screen.getByRole('tab', { name: 'Inline CSV' })).toBeVisible();
		await expect.element(screen.getByRole('tab', { name: 'Local file' })).toBeVisible();

		await screen.getByLabelText('CSV rows').fill('hello');
		await vi.waitFor(() => {
			expect(screen.getByRole('button', { name: 'Review ingestion' }).element()).not.toBeDisabled();
		});

		await screen.getByRole('tab', { name: 'Local file' }).click();
		await screen
			.getByLabelText('CSV or Parquet file')
			.upload(new File(['parquet'], 'events.parquet', { type: 'application/vnd.apache.parquet' }));
		await vi.waitFor(() => {
			expect(screen.getByText(/events\.parquet/).element()).toBeInTheDocument();
			expect(screen.getByRole('button', { name: 'Review ingestion' }).element()).not.toBeDisabled();
		});
	});
});
