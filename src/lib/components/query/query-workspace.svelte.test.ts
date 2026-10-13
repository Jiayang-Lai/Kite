import { afterEach, describe, expect, it, vi } from 'vitest';
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

import QueryWorkspaceRunningWrapper from '../../../../tests/fixtures/query-workspace-running-wrapper.svelte';
import QueryWorkspaceWrapper from '../../../../tests/fixtures/query-workspace-wrapper.svelte';
import QueryWorkspace from './query-workspace.svelte';

describe('QueryWorkspace', () => {
	afterEach(() => {
		runtimeMocks.failingClusterName = undefined;
	});

	it('renders its lazily loaded overview and saved-query views', async () => {
		const screen = await render(
			QueryWorkspace,
			{ view: 'overview' },
			{
				wrapper: QueryWorkspaceWrapper
			}
		);

		await expect.element(screen.getByText('Explore Mock cluster')).toBeVisible();
		await expect.element(screen.getByText('Search the cluster schema')).toBeVisible();

		await screen.rerender({ view: 'saved-queries' });
		await expect.element(screen.getByText('Saved queries')).toBeVisible();
	});

	it('coordinates save, unload protection, tabs, and comparison from the editor', async () => {
		const screen = await render(
			QueryWorkspace,
			{ view: 'editor' },
			{
				wrapper: QueryWorkspaceWrapper
			}
		);

		const saveButton = screen.getByTitle('Save query locally');
		await expect.element(saveButton).toBeInTheDocument();
		const beforeUnload = new Event('beforeunload', { cancelable: true });
		window.dispatchEvent(beforeUnload);
		expect(beforeUnload.defaultPrevented).toBe(true);

		(saveButton.element() as HTMLButtonElement).click();
		await expect.element(screen.getByRole('heading', { name: 'Save query' })).toBeVisible();
		await screen.getByRole('button', { name: 'Save query' }).click();
		await expect.element(screen.getByText('Enter a name for this query.')).toBeVisible();

		await screen.getByLabelText('Query name').fill('Event count');
		await screen.getByRole('button', { name: 'Save query' }).click();
		await expect
			.element(screen.getByRole('heading', { name: 'Save query' }))
			.not.toBeInTheDocument();
		const cleanBeforeUnload = new Event('beforeunload', { cancelable: true });
		window.dispatchEvent(cleanBeforeUnload);
		expect(cleanBeforeUnload.defaultPrevented).toBe(false);

		const monaco = await import('monaco-editor/esm/vs/editor/editor.api.js');
		const editorModel = monaco.editor
			.getModels()
			.find((model) => model.getValue() === 'Events | count');
		expect(editorModel).toBeDefined();
		editorModel?.setValue('Events | count1');
		await expect.element(screen.getByText('Unsaved changes')).toBeInTheDocument();

		await screen.getByRole('button', { name: 'Expand all' }).click();
		await expect.element(screen.getByRole('button', { name: 'Collapse all' })).toBeInTheDocument();

		(
			screen.getByRole('button', { name: 'Collapse results drawer' }).element() as HTMLButtonElement
		).click();
		await expect
			.element(screen.getByRole('button', { name: 'Expand results drawer' }))
			.toBeInTheDocument();
		(
			screen.getByRole('button', { name: 'Expand results drawer' }).element() as HTMLButtonElement
		).click();

		(screen.getByRole('button', { name: 'New query tab' }).element() as HTMLButtonElement).click();
		await expect.element(screen.getByRole('tab', { name: 'Untitled query' })).toBeVisible();
		(screen.getByRole('button', { name: 'Compare' }).element() as HTMLButtonElement).click();
		const comparison = screen.getByLabelText('Query comparison');
		await expect.element(comparison).toBeVisible();

		(screen.getByRole('button', { name: 'Close diff' }).element() as HTMLButtonElement).click();
		await expect.element(screen.getByLabelText('Query comparison')).not.toBeInTheDocument();

		const firstTab = screen.getByRole('tab', { name: /Event count/ });
		(firstTab.element().querySelector('button') as HTMLButtonElement).dispatchEvent(
			new MouseEvent('click', { bubbles: true, shiftKey: true })
		);
		await expect.element(comparison).toBeVisible();

		const comparisonRunButton = screen.getByRole('button', { name: 'Run' });
		comparisonRunButton.element().removeAttribute('disabled');
		(comparisonRunButton.element() as HTMLButtonElement).click();
		(screen.getByRole('button', { name: 'Close diff' }).element() as HTMLButtonElement).click();
		await expect.element(screen.getByLabelText('Query comparison')).not.toBeInTheDocument();

		const runButton = screen.getByRole('button', { name: 'Run' });
		runButton.element().removeAttribute('disabled');
		(runButton.element() as HTMLButtonElement).click();

		(firstTab.element().querySelector('button') as HTMLButtonElement).click();
		(
			screen.getByRole('button', { name: 'Close Event count' }).element() as HTMLButtonElement
		).click();
		await expect.element(screen.getByRole('tab', { name: /Event count/ })).toBeVisible();
		await screen.getByRole('button', { name: 'Close tab' }).click();
		await expect.element(screen.getByRole('tab', { name: /Event count/ })).not.toBeInTheDocument();
	}, 30_000);

	it('forwards cancellation for a running tab', async () => {
		const screen = await render(
			QueryWorkspace,
			{ view: 'editor' },
			{ wrapper: QueryWorkspaceRunningWrapper }
		);

		const cancelButton = screen.getByRole('button', { name: 'Cancel' });
		await expect.element(cancelButton).toBeVisible();
		(cancelButton.element() as HTMLButtonElement).click();
	});

	it('loads a saved query from the editor sidebar into a tab', async () => {
		const screen = await render(
			QueryWorkspace,
			{ view: 'editor' },
			{ wrapper: QueryWorkspaceWrapper }
		);

		await screen.getByRole('button', { name: 'Toggle cluster explorer' }).click();
		const savedQueriesLabel = screen.getByText('Saved queries');
		await expect.element(savedQueriesLabel).toBeVisible();
		const savedQueriesButton = savedQueriesLabel.element().closest('button');
		expect(savedQueriesButton).not.toBeNull();
		savedQueriesButton?.click();

		const savedQuery = screen.getByTitle('StormEvents | count');
		await expect.element(savedQuery).toBeVisible();
		(savedQuery.element() as HTMLButtonElement).click();
		await expect.element(screen.getByRole('tab', { name: 'StormEvents' })).toBeVisible();
	});

	it('switches clusters through the shared connection lifecycle', async () => {
		const screen = await render(
			QueryWorkspace,
			{ view: 'overview' },
			{ wrapper: QueryWorkspaceWrapper }
		);

		await screen.getByRole('button', { name: 'Toggle cluster explorer' }).click();
		const clusterLabel = screen.getByTitle('Mock cluster');
		await expect.element(clusterLabel).toBeVisible();
		const clusterSelector = clusterLabel.element().closest('button');
		expect(clusterSelector).not.toBeNull();
		clusterSelector?.click();
		await screen.getByRole('menuitem', { name: /Emulated cluster/ }).click();
		await expect
			.element(screen.getByText('Switching connections will close all query tabs.'))
			.toBeVisible();
		await screen.getByRole('button', { name: 'Switch connection' }).click();

		await expect.element(screen.getByText('Explore Emulated cluster')).toBeVisible();
	});

	it('offers retry or continuing with the current cluster when a switch fails', async () => {
		runtimeMocks.failingClusterName = 'Emulated cluster';
		const screen = await render(
			QueryWorkspace,
			{ view: 'overview' },
			{ wrapper: QueryWorkspaceWrapper }
		);

		await screen.getByRole('button', { name: 'Toggle cluster explorer' }).click();
		const clusterLabel = screen.getByTitle('Mock cluster');
		await expect.element(clusterLabel).toBeVisible();
		clusterLabel.element().closest('button')?.click();
		await screen.getByRole('menuitem', { name: /Emulated cluster/ }).click();
		await screen.getByRole('button', { name: 'Switch connection' }).click();
		await expect.element(screen.getByText('Could not connect to Emulated cluster')).toBeVisible();

		// The explorer sheet stays open over the page, so click the dialog through the DOM.
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
		await expect.element(screen.getByText('Explore Mock cluster')).toBeVisible();
	});
});
