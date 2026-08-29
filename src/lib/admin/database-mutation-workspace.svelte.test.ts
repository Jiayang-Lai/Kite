import { describe, expect, it } from 'vitest';

import { createDatabaseMutationWorkspace } from './database-mutation-workspace.svelte';

describe('createDatabaseMutationWorkspace', () => {
	it('owns dialog visibility and busy state', () => {
		const workspace = createDatabaseMutationWorkspace();

		workspace.state.editorOpen = true;
		workspace.state.isPreparingEditor = true;
		expect(workspace.isDialogOpen).toBe(true);
		expect(workspace.isBusy).toBe(true);

		workspace.closeEditors();
		expect(workspace.isDialogOpen).toBe(false);
		workspace.state.isPreparingEditor = false;
		expect(workspace.isBusy).toBe(false);
	});

	it('closes every dialog and clears editor targets after a connection change', () => {
		const workspace = createDatabaseMutationWorkspace();
		workspace.state.databaseDialogOpen = true;
		workspace.state.tableDropOpen = true;
		workspace.state.editorTable = { name: 'Events', columns: [] } as never;

		workspace.closeAll();

		expect(workspace.isDialogOpen).toBe(false);
		expect(workspace.state.editorTable).toBeUndefined();
	});
});
