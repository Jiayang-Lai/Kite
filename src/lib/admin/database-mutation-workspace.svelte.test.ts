import { beforeEach, describe, expect, it, vi } from 'vitest';

const adapterMocks = vi.hoisted(() => ({
	prepareTable: vi.fn(),
	mutateTable: vi.fn(),
	createTable: vi.fn(),
	dropTable: vi.fn(),
	mutateDatabase: vi.fn()
}));
const controllerMocks = vi.hoisted(() => ({ cancel: vi.fn(), dispose: vi.fn() }));

vi.mock('./database-mutation-controller.svelte', () => ({
	createDatabaseMutationController: vi.fn(() => {
		let current = 0;
		return {
			begin: () => ++current,
			isCurrent: (id: number) => id === current,
			finish: (id: number) => id === current,
			adapter: () => adapterMocks,
			cancel: controllerMocks.cancel,
			dispose: controllerMocks.dispose
		};
	})
}));

import { createDatabaseMutationWorkspace } from './database-mutation-workspace.svelte';

const table = {
	name: 'Events',
	docstring: 'Event rows',
	columns: [
		{ name: 'Id', type: 'long' },
		{ name: 'Message', type: 'string' }
	]
};
const snapshot = {
	databaseName: 'Analytics',
	tableName: 'Events',
	columns: table.columns,
	docstring: 'Event rows'
};

function setup() {
	let schema = {
		Analytics: {
			name: 'Analytics',
			prettyName: 'Friendly analytics',
			tables: [table],
			functions: []
		},
		Archive: { name: 'Archive', tables: [], functions: [] }
	};
	const refresh = vi.fn(async () => undefined);
	const select = vi.fn();
	const options = {
		store: {
			clusters: [
				{
					id: 'mock',
					name: 'Mock',
					url: 'mock://kite',
					kind: 'mock' as const,
					mockSchemaRevision: 3
				}
			],
			updateMockSchema: vi.fn()
		},
		getClusterId: () => 'mock',
		getDatabases: () => schema,
		getActiveDatabase: () => schema.Analytics,
		setSelectedDatabase: select,
		onrefreshschema: refresh
	};
	return {
		workspace: createDatabaseMutationWorkspace(options as never),
		refresh,
		select,
		setSchema(next: typeof schema) {
			schema = next;
		}
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	adapterMocks.prepareTable.mockResolvedValue({ kind: 'ready', snapshot });
	adapterMocks.mutateTable.mockResolvedValue({ mockSchemaRevision: 4 });
	adapterMocks.createTable.mockResolvedValue({ mockSchemaRevision: 4 });
	adapterMocks.dropTable.mockResolvedValue({ mockSchemaRevision: 4 });
	adapterMocks.mutateDatabase.mockResolvedValue({ mockSchemaRevision: 4 });
});

describe('createDatabaseMutationWorkspace', () => {
	it('owns dialog visibility, busy state, cancellation, and disposal', () => {
		const workspace = createDatabaseMutationWorkspace();
		workspace.state.editorOpen = true;
		workspace.state.isPreparingEditor = true;
		expect(workspace.isDialogOpen).toBe(true);
		expect(workspace.isBusy).toBe(true);

		workspace.cancel();
		workspace.dispose();
		workspace.closeEditors();
		expect(workspace.isDialogOpen).toBe(false);
		workspace.state.isPreparingEditor = false;
		expect(workspace.isBusy).toBe(false);
	});

	it('opens table and column editors against canonical schema objects', async () => {
		const { workspace } = setup();
		workspace.openTableEditor({ ...table } as never);
		await vi.waitFor(() => expect(workspace.state.isPreparingEditor).toBe(false));
		expect(workspace.state.editorOpen).toBe(true);
		expect(workspace.state.editorTable).toEqual(table);
		expect(workspace.state.editorSnapshot).toEqual(snapshot);

		workspace.openColumnEditor(
			table as never,
			{ name: 'Message', type: 'string' } as never,
			'rename'
		);
		await vi.waitFor(() => expect(workspace.state.isPreparingEditor).toBe(false));
		expect(workspace.state.columnEditorOpen).toBe(true);
		expect(workspace.state.columnMutationAction).toBe('rename');

		workspace.openColumnOrderEditor(table as never);
		await vi.waitFor(() => expect(workspace.state.isPreparingEditor).toBe(false));
		expect(workspace.state.columnOrderOpen).toBe(true);
	});

	it('ignores editor requests for entities absent from the active schema', () => {
		const { workspace } = setup();
		workspace.openTableEditor({ name: 'Missing', columns: [] } as never);
		workspace.openColumnEditor(
			table as never,
			{ name: 'Missing', type: 'string' } as never,
			'drop'
		);
		workspace.openColumnOrderEditor({ name: 'Missing', columns: [] } as never);
		expect(workspace.isDialogOpen).toBe(false);
		expect(adapterMocks.prepareTable).not.toHaveBeenCalled();
	});

	it('refreshes and closes an editor when preflight finds a conflict', async () => {
		adapterMocks.prepareTable.mockResolvedValueOnce({ kind: 'conflict', conflicts: [] });
		const { workspace, refresh } = setup();
		workspace.openTableEditor(table as never);
		await vi.waitFor(() => expect(workspace.state.isPreparingEditor).toBe(false));
		expect(refresh).toHaveBeenCalledWith('mock');
		expect(workspace.state.editorOpen).toBe(false);
		expect(workspace.state.mutationSuccess).toContain('table changed');
	});

	it('reports preflight errors and keeps mutation disabled', async () => {
		adapterMocks.prepareTable.mockRejectedValueOnce(new Error('Permission denied'));
		const { workspace } = setup();
		workspace.openTableEditor(table as never);
		await vi.waitFor(() => expect(workspace.state.isPreparingEditor).toBe(false));
		expect(workspace.state.editorSnapshot).toBeUndefined();
		expect(workspace.state.mutationError).toContain('Permission denied');
	});

	it('updates a verified table and blocks stale updates', async () => {
		const { workspace, refresh } = setup();
		workspace.openTableEditor(table as never);
		await vi.waitFor(() => expect(workspace.state.editorSnapshot).toBeDefined());
		await workspace.updateTable({ summary: 'Column renamed' } as never);
		expect(adapterMocks.mutateTable).toHaveBeenCalledWith(
			'Analytics',
			'Events',
			expect.objectContaining({ tableName: 'Events' }),
			expect.objectContaining({ summary: 'Column renamed' })
		);
		expect(workspace.state.mutationSuccess).toBe('Analytics.Events: Column renamed.');
		expect(workspace.state.editorOpen).toBe(false);

		workspace.openTableEditor(table as never);
		await vi.waitFor(() => expect(workspace.state.editorSnapshot).toBeDefined());
		adapterMocks.mutateTable.mockResolvedValueOnce({
			kind: 'conflict',
			conflicts: [{ message: 'Column Id changed.' }]
		});
		await workspace.updateTable({ summary: 'Rename' } as never);
		expect(workspace.state.editorSnapshot).toBeUndefined();
		expect(workspace.state.mutationError).toContain('Column Id changed.');
		expect(refresh).toHaveBeenCalledWith('mock');
	});

	it('reports table mutation command failures', async () => {
		const { workspace } = setup();
		workspace.openTableEditor(table as never);
		await vi.waitFor(() => expect(workspace.state.editorSnapshot).toBeDefined());
		adapterMocks.mutateTable.mockRejectedValueOnce(new Error('Command failed'));
		await workspace.updateTable({ summary: 'Rename' } as never);
		expect(workspace.state.mutationError).toBe('Command failed');
		expect(workspace.state.isMutating).toBe(false);
	});

	it('creates a table only after refreshed schema contains it', async () => {
		const context = setup();
		context.workspace.openCreateTable();
		context.refresh.mockImplementationOnce(async () => {
			context.setSchema({
				Analytics: {
					name: 'Analytics',
					prettyName: 'Friendly analytics',
					tables: [table, { name: 'NewTable', docstring: '', columns: [] }],
					functions: []
				},
				Archive: { name: 'Archive', tables: [], functions: [] }
			});
		});
		await context.workspace.createTable({
			tableName: 'NewTable',
			summary: 'Table created'
		} as never);
		expect(context.workspace.state.createTableOpen).toBe(false);
		expect(context.workspace.state.mutationSuccess).toBe('Analytics.NewTable: Table created.');
		expect(context.select).toHaveBeenCalledWith('Analytics');
	});

	it('keeps create dialog open when refreshed schema is missing the table', async () => {
		const { workspace } = setup();
		workspace.openCreateTable();
		await workspace.createTable({ tableName: 'Missing', summary: 'Table created' } as never);
		expect(workspace.state.createTableOpen).toBe(true);
		expect(workspace.state.createTableError).toContain('was not found');
		expect(workspace.state.isCreatingTable).toBe(false);
	});

	it('drops tables and surfaces stale-schema conflicts', async () => {
		const { workspace, refresh } = setup();
		workspace.openDropTable(table as never);
		await workspace.removeTable();
		expect(refresh).toHaveBeenCalledWith('mock');
		expect(workspace.state.mutationSuccess).toBe('Table Analytics.Events removed.');

		workspace.openDropTable(table as never);
		adapterMocks.dropTable.mockResolvedValueOnce({
			kind: 'conflict',
			conflicts: [{ message: 'Table changed.' }]
		});
		await expect(workspace.removeTable()).rejects.toThrow('Table changed.');
		expect(workspace.state.isDroppingTable).toBe(false);
	});

	it('executes create, rename, and drop database mutations', async () => {
		const context = setup();
		const { workspace } = context;
		workspace.openDatabaseDialog('rename');
		expect(workspace.state.databaseDialogInitialName).toBe('Friendly analytics');
		await workspace.mutateDatabase({ name: 'Renamed' } as never);
		expect(context.select).toHaveBeenLastCalledWith('Renamed');
		expect(workspace.state.mutationSuccess).toBe('Database Analytics renamed to Renamed.');

		workspace.openDatabaseDialog('create');
		await workspace.mutateDatabase({ name: ' NewDatabase ' } as never);
		expect(context.select).toHaveBeenLastCalledWith('NewDatabase');
		expect(workspace.state.mutationSuccess).toBe('Database NewDatabase created.');

		workspace.openDatabaseDialog('drop', { name: 'Analytics', tables: [] });
		await workspace.mutateDatabase({} as never);
		expect(context.select).toHaveBeenLastCalledWith('Archive');
		expect(workspace.state.mutationSuccess).toBe('Database Analytics deleted.');
	});

	it('rejects database mutations after the active cluster disappears', async () => {
		const workspace = createDatabaseMutationWorkspace({
			store: { clusters: [], updateMockSchema: vi.fn() },
			getClusterId: () => 'missing',
			getDatabases: () => ({}),
			getActiveDatabase: () => undefined,
			setSelectedDatabase: vi.fn()
		} as never);
		workspace.state.databaseDialogAction = 'create';
		await expect(workspace.mutateDatabase({ name: 'New' } as never)).rejects.toThrow(
			'cluster no longer exists'
		);
	});

	it('closes every dialog and clears editor targets after a connection change', () => {
		const workspace = createDatabaseMutationWorkspace();
		workspace.state.databaseDialogOpen = true;
		workspace.state.tableDropOpen = true;
		workspace.state.editorTable = table as never;
		workspace.state.editorColumn = table.columns[0] as never;
		workspace.closeAll();
		expect(workspace.isDialogOpen).toBe(false);
		expect(workspace.state.editorTable).toBeUndefined();
		expect(workspace.state.editorColumn).toBeUndefined();
	});
});
