import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

const runtimeMocks = vi.hoisted(() => ({ failingClusterName: undefined as string | undefined }));

vi.mock('$lib/cluster/cluster-runtime', async (importOriginal) => {
	const original = await importOriginal<typeof import('$lib/cluster/cluster-runtime')>();
	return {
		...original,
		createConnectionRuntime: (cluster: Parameters<typeof original.createConnectionRuntime>[0]) => {
			const runtime = original.createConnectionRuntime(cluster);
			if (cluster.name !== runtimeMocks.failingClusterName) return runtime;
			return { ...runtime, loadSchema: () => Promise.reject(new Error('Cluster unreachable.')) };
		}
	};
});

import AppContextWrapper from '../../../../tests/fixtures/app-context-wrapper.svelte';
import AdminWorkspace from './admin-workspace.svelte';

describe('AdminWorkspace', () => {
	beforeEach(() => {
		localStorage.clear();
		runtimeMocks.failingClusterName = undefined;
	});

	async function chooseCluster(screen: Awaited<ReturnType<typeof render>>, name: RegExp) {
		await screen.getByRole('button', { name: 'Toggle admin navigation' }).click();
		const clusterLabel = screen.getByTitle('Mock cluster');
		await expect.element(clusterLabel).toBeVisible();
		clusterLabel.element().closest('button')?.click();
		await screen.getByRole('menuitem', { name }).click();
	}

	it('renders every administrative workspace for the ready mock cluster', async () => {
		const screen = await render(
			AdminWorkspace,
			{ view: 'overview' },
			{ wrapper: AppContextWrapper }
		);

		await expect
			.element(screen.getByRole('heading', { name: 'Operate Mock cluster' }))
			.toBeVisible();
		await expect.element(screen.getByText('Mock cluster', { exact: true }).first()).toBeVisible();

		await screen.rerender({ view: 'databases' });
		await expect
			.element(screen.getByText('Databases & tables', { exact: true }).first())
			.toBeVisible();
		await expect.element(screen.getByRole('heading', { name: 'Databases' })).toBeVisible();

		await screen.rerender({ view: 'commands' });
		await expect
			.element(screen.getByText('Management commands', { exact: true }).first())
			.toBeVisible();
		await expect.element(screen.getByText(/Run and inspect administrative/)).toBeVisible();

		await screen.rerender({ view: 'ingestion' });
		await expect.element(screen.getByText('Data ingestion', { exact: true }).first()).toBeVisible();
	});

	it('switches clusters through the shared connection lifecycle', async () => {
		const screen = await render(
			AdminWorkspace,
			{ view: 'overview' },
			{ wrapper: AppContextWrapper }
		);

		await screen.getByRole('button', { name: 'Toggle admin navigation' }).click();
		const clusterLabel = screen.getByTitle('Mock cluster');
		await expect.element(clusterLabel).toBeVisible();
		const clusterSelector = clusterLabel.element().closest('button');
		expect(clusterSelector).not.toBeNull();
		clusterSelector?.click();
		await screen.getByRole('menuitem', { name: /Emulated cluster/ }).click();

		await expect
			.element(screen.getByRole('heading', { name: 'Operate Emulated cluster' }))
			.toBeVisible();
	});

	it('offers retry or continuing with the current cluster when a switch fails', async () => {
		runtimeMocks.failingClusterName = 'Emulated cluster';
		const screen = await render(
			AdminWorkspace,
			{ view: 'overview' },
			{ wrapper: AppContextWrapper }
		);
		await expect
			.element(screen.getByRole('heading', { name: 'Operate Mock cluster' }))
			.toBeVisible();

		await chooseCluster(screen, /Emulated cluster/);
		await expect.element(screen.getByText('Could not connect to Emulated cluster')).toBeVisible();
		await expect.element(screen.getByText('Cluster unreachable.').first()).toBeVisible();

		// The navigation sheet stays open over the page, so click the dialog through the DOM.
		(screen.getByRole('button', { name: 'Retry' }).element() as HTMLButtonElement).click();
		await expect.element(screen.getByText('Could not connect to Emulated cluster')).toBeVisible();

		(
			screen
				.getByRole('button', { name: 'Continue with Mock cluster' })
				.element() as HTMLButtonElement
		).click();
		await expect
			.element(screen.getByText('Could not connect to Emulated cluster'))
			.not.toBeInTheDocument();
		await expect
			.element(screen.getByRole('heading', { name: 'Operate Mock cluster' }))
			.toBeVisible();
	});
});
