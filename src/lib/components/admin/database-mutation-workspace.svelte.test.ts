import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';

import { createDatabaseMutationWorkspace } from '$lib/admin/database-mutation-workspace.svelte';
import AppContextWrapper from '../../../../tests/fixtures/app-context-wrapper.svelte';
import DatabaseMutationWorkspace from './database-mutation-workspace.svelte';

const table = {
	name: "O'Brien\\Events",
	columns: [
		{ name: 'Message', type: 'string' },
		{ name: 'Count', type: 'long' }
	]
};

function renderWorkspace() {
	const workspace = createDatabaseMutationWorkspace();
	const props = {
		workspace,
		databases: { Samples: { name: 'Samples', tables: [table], functions: [] } },
		clusterName: 'Mock cluster',
		clusterKind: 'mock' as const,
		renameMode: 'canonical' as const
	};
	return { workspace, props };
}

describe('DatabaseMutationWorkspace', () => {
	it('shows the table editor checking the schema, then updating the table', async () => {
		const { workspace, props } = renderWorkspace();
		Object.assign(workspace.state, {
			editorDatabaseName: 'Samples',
			editorTable: table,
			editorOpen: true,
			running: 'prepare-editor'
		});
		const screen = await render(DatabaseMutationWorkspace, props, { wrapper: AppContextWrapper });

		await expect.element(screen.getByText('Checking current schema')).toBeVisible();

		workspace.state.running = 'update-table';
		await expect.element(screen.getByText('Updating table')).toBeVisible();
		await expect.element(screen.getByText('Checking current schema')).not.toBeInTheDocument();
	});

	it('shows the column editor checking the schema, then saving the column', async () => {
		const { workspace, props } = renderWorkspace();
		Object.assign(workspace.state, {
			editorDatabaseName: 'Samples',
			editorTable: table,
			editorColumn: table.columns[0],
			columnMutationAction: 'edit',
			columnEditorOpen: true,
			running: 'prepare-editor'
		});
		const screen = await render(DatabaseMutationWorkspace, props, { wrapper: AppContextWrapper });

		await expect.element(screen.getByText('Checking current schema')).toBeVisible();

		workspace.state.running = 'update-table';
		await expect.element(screen.getByText('Saving column')).toBeVisible();
	});

	it('shows only the running request as running', async () => {
		const { workspace, props } = renderWorkspace();
		Object.assign(workspace.state, {
			editorDatabaseName: 'Samples',
			createTableOpen: true,
			running: 'create-table'
		});
		const screen = await render(DatabaseMutationWorkspace, props, { wrapper: AppContextWrapper });

		await expect.element(screen.getByText('Creating table')).toBeVisible();

		workspace.state.running = 'mutate-database';
		await expect.element(screen.getByRole('button', { name: 'Review table' })).toBeVisible();
		await expect.element(screen.getByText('Creating table')).not.toBeInTheDocument();
	});
});
