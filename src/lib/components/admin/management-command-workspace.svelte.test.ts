import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

const queryClientMocks = vi.hoisted(() => ({ startKustoManagementCommand: vi.fn() }));

vi.mock('$lib/kusto/query-client', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/kusto/query-client')>()),
	startKustoManagementCommand: queryClientMocks.startKustoManagementCommand
}));

import ManagementCommandWorkspace from './management-command-workspace.svelte';

const props = {
	databases: { Analytics: { name: 'Analytics', tables: [] } },
	selectedDatabase: 'Analytics',
	clusterUrl: 'https://help.kusto.windows.net',
	clusterName: 'Help cluster',
	managementCommands: true
};

describe('ManagementCommandWorkspace', () => {
	it('runs a read-only command and reports its failure without refreshing the schema', async () => {
		queryClientMocks.startKustoManagementCommand.mockImplementation(() => ({
			promise: Promise.reject(new Error('Permission denied.')),
			cancel: vi.fn()
		}));
		const onrefreshschema = vi.fn();
		const screen = await render(ManagementCommandWorkspace, { ...props, onrefreshschema });

		await expect.element(screen.getByText('Help cluster')).toBeVisible();
		await expect.element(screen.getByText('Changes cluster state')).not.toBeInTheDocument();
		// The resizable layout can leave controls outside the test viewport, so click through the DOM.
		(
			screen.getByRole('button', { name: 'Run', exact: true }).element() as HTMLButtonElement
		).click();

		await expect.element(screen.getByText('Permission denied.')).toBeVisible();
		expect(queryClientMocks.startKustoManagementCommand).toHaveBeenCalledWith(
			'Analytics',
			'.show tables',
			'https://help.kusto.windows.net'
		);
		expect(onrefreshschema).not.toHaveBeenCalled();
	});

	it('explains why emulated clusters cannot run management commands', async () => {
		const screen = await render(ManagementCommandWorkspace, {
			...props,
			managementCommands: false,
			isEmulatedCluster: true
		});

		await expect
			.element(screen.getByText('Management commands are not supported for emulated clusters'))
			.toBeVisible();
	});
});
