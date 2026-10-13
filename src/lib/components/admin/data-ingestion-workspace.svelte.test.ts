import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

const queryClientMocks = vi.hoisted(() => ({ startKustoManagementCommand: vi.fn() }));

vi.mock('$lib/kusto/query-client', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/kusto/query-client')>()),
	startKustoManagementCommand: queryClientMocks.startKustoManagementCommand
}));

import DataIngestionWorkspace from './data-ingestion-workspace.svelte';

const kustainerProps = {
	databases: {
		Analytics: {
			name: 'Analytics',
			tables: [{ name: 'Events', columns: [{ name: 'Message', type: 'string' }] }]
		}
	},
	selectedDatabase: 'Analytics',
	selectedTable: 'Events',
	clusterId: 'local',
	clusterUrl: 'http://localhost:8080',
	clusterName: 'Local Kustainer',
	ingestion: {
		mode: 'kustainer' as const,
		containerRoot: '/kustodata/raw',
		maxInlineFileBytes: 1024 * 1024,
		maxInlineCommandBytes: 64 * 1024
	},
	ingestionEnabled: true
};

type Screen = Awaited<ReturnType<typeof render>>;

function clickTab(screen: Screen, name: string) {
	clickButton(screen, name, 'tab');
}

// The resizable layout can leave controls outside the test viewport, so click through the DOM.
function clickButton(screen: Screen, name: string, role: 'button' | 'tab' = 'button') {
	(screen.getByRole(role, { name }).element() as HTMLButtonElement).click();
}

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
		});

		await expect.element(screen.getByText('Ingest into an existing table')).toBeVisible();
		await expect.element(screen.getByRole('tab', { name: 'Inline CSV' })).toBeVisible();
		await expect.element(screen.getByRole('tab', { name: 'Local file' })).toBeVisible();

		await screen.getByLabelText('CSV rows').fill('hello');
		await vi.waitFor(() => {
			expect(screen.getByRole('button', { name: 'Review ingestion' }).element()).not.toBeDisabled();
		});

		(screen.getByRole('tab', { name: 'Local file' }).element() as HTMLButtonElement).click();
		await screen
			.getByLabelText('CSV or Parquet file')
			.upload(new File(['parquet'], 'events.parquet', { type: 'application/vnd.apache.parquet' }));
		await vi.waitFor(() => {
			expect(screen.getByText(/events\.parquet/).element()).toBeInTheDocument();
			expect(screen.getByRole('button', { name: 'Review ingestion' }).element()).not.toBeDisabled();
		});
	});

	it('ingests a CSV file as confirmed inline chunks on Kustainer', async () => {
		queryClientMocks.startKustoManagementCommand.mockImplementation(() => ({
			promise: Promise.resolve({
				columns: [{ name: 'ExtentId', type: 'guid' }],
				rows: [['extent-1']],
				totalRowCount: 1,
				renderedRowCount: 1,
				warnings: [],
				elapsedMs: 1,
				clientRequestId: 'Kite.Test;1'
			}),
			cancel: vi.fn()
		}));
		const screen = await render(DataIngestionWorkspace, kustainerProps);

		clickTab(screen, 'Inline file');
		await screen
			.getByLabelText('CSV file')
			.upload(new File(['Message\nhello\nworld\n'], 'events.csv', { type: 'text/csv' }));
		await expect.element(screen.getByText('Header:')).toBeVisible();
		await expect.element(screen.getByText('Chunks')).toBeVisible();

		clickButton(screen, 'Review ingestion');
		await expect.element(screen.getByText('Ingest data into Events?')).toBeVisible();
		await expect.element(screen.getByText(/sequential \.ingest inline commands/)).toBeVisible();
		await screen.getByLabelText('Type RUN to enable ingestion').fill('RUN');
		clickButton(screen, 'Ingest data');

		await expect.element(screen.getByText(/chunks completed/)).toBeVisible();
		await expect.element(screen.getByText(/2 rows confirmed/)).toBeVisible();
		await expect.element(screen.getByText(/1 extents returned/)).toBeVisible();
		await expect.element(screen.getByRole('button', { name: 'Review retry' })).toBeVisible();
	});

	it('offers a rescan after Kustainer rejects a non-CSV inline file', async () => {
		const screen = await render(DataIngestionWorkspace, kustainerProps);

		clickTab(screen, 'Inline file');
		await screen.getByLabelText('CSV file').upload(new File(['parquet'], 'events.parquet'));
		await expect.element(screen.getByText(/accepts uncompressed \.csv files only/)).toBeVisible();
		clickButton(screen, 'Scan again');
		await expect.element(screen.getByText(/accepts uncompressed \.csv files only/)).toBeVisible();
	});

	it('reviews mounted and remote files that Kustainer reads directly', async () => {
		const screen = await render(DataIngestionWorkspace, kustainerProps);

		clickTab(screen, 'Mounted file');
		await expect.element(screen.getByText('/kustodata/raw/…')).toBeVisible();
		await screen.getByLabelText('Relative file path').fill('events.parquet');
		await expect.element(screen.getByText('/kustodata/raw/events.parquet')).toBeVisible();
		await expect.element(screen.getByText(/Source shape cannot be checked/)).toBeVisible();

		clickButton(screen, 'Review ingestion');
		await expect.element(screen.getByText(/Source shape was not checked/)).toBeVisible();
		clickButton(screen, 'Close confirmation');
		await expect.element(screen.getByText('Ingest data into Events?')).not.toBeInTheDocument();

		clickTab(screen, 'Remote file');
		await screen.getByLabelText('File URL').fill('https://example.com/events.csv');
		await expect.element(screen.getByText('Skip first line')).toBeVisible();
		clickButton(screen, 'Review ingestion');
		await expect
			.element(
				screen.getByRole('dialog').getByText('https://example.com/events.csv', { exact: true })
			)
			.toBeVisible();
		clickButton(screen, 'Cancel');
		await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument();
	});

	it('warns when inline CSV has more columns than the target table', async () => {
		const screen = await render(DataIngestionWorkspace, kustainerProps);

		await screen.getByLabelText('CSV rows').fill('hello,extra');
		await expect.element(screen.getByText('Source shape differs from the target')).toBeVisible();
		await expect.element(screen.getByText('+ 1 extra source column')).toBeVisible();

		clickButton(screen, 'Review ingestion');
		await expect
			.element(screen.getByText('Review source-shape warnings before continuing'))
			.toBeVisible();
	});

	it('reports an inline CSV that cannot be scanned', async () => {
		const screen = await render(DataIngestionWorkspace, kustainerProps);

		await screen.getByLabelText('CSV rows').fill('"unterminated');
		await expect.element(screen.getByText(/ends inside a quoted field/)).toBeVisible();
		expect(screen.getByRole('button', { name: 'Review ingestion' }).element()).toBeDisabled();
	});

	it('marks target columns whose source header differs or is missing', async () => {
		const screen = await render(DataIngestionWorkspace, {
			...kustainerProps,
			databases: {
				Analytics: {
					name: 'Analytics',
					tables: [
						{
							name: 'Events',
							columns: [
								{ name: 'Message', type: 'string' },
								{ name: 'Level', type: 'string' }
							]
						}
					]
				}
			}
		});

		(screen.container.querySelector('#inline-data-has-header') as HTMLInputElement).click();
		await screen.getByLabelText('CSV rows').fill('Text\nhello');
		await expect.element(screen.getByText('Source header: Text')).toBeVisible();
		await expect
			.element(screen.getByText('1 source columns; the target table has 2.'))
			.toBeVisible();
	});

	it('shows an empty target panel for a database without tables', async () => {
		const screen = await render(DataIngestionWorkspace, {
			...kustainerProps,
			databases: { Analytics: { name: 'Analytics', tables: [] } },
			selectedTable: undefined
		});

		await expect.element(screen.getByText('Select a table')).toBeVisible();
		await expect.element(screen.getByText('No table columns available.')).toBeVisible();
	});

	it('explains why a remote file URL cannot be used', async () => {
		const screen = await render(DataIngestionWorkspace, kustainerProps);

		clickTab(screen, 'Remote file');
		await screen.getByLabelText('File URL').fill('not a url');
		await expect.element(screen.getByRole('alert')).toBeVisible();
		expect(screen.getByRole('button', { name: 'Review ingestion' }).element()).toBeDisabled();
	});
});
