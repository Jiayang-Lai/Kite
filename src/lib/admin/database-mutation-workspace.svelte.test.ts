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
import { PartialSchemaMutationError } from './schema-mutation-adapter';

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
		const { workspace } = setup();
		workspace.state.editorOpen = true;
		workspace.state.running = 'prepare-editor';
		expect(workspace.isDialogOpen).toBe(true);
		expect(workspace.isBusy).toBe(true);

		workspace.cancel();
		workspace.dispose();
		expect(controllerMocks.cancel).toHaveBeenCalledOnce();
		expect(controllerMocks.dispose).toHaveBeenCalledOnce();
		workspace.closeEditors();
		expect(workspace.isDialogOpen).toBe(false);
		workspace.state.running = undefined;
		expect(workspace.isBusy).toBe(false);
	});

	it('cancels the running request only when its dialog closes', () => {
		const { workspace } = setup();
		workspace.cancelWhenDialogsClose();
		workspace.state.editorOpen = true;
		workspace.state.running = 'update-table';
		workspace.cancelWhenDialogsClose();
		expect(controllerMocks.cancel).not.toHaveBeenCalled();

		workspace.state.editorOpen = false;
		workspace.cancelWhenDialogsClose();
		expect(controllerMocks.cancel).toHaveBeenCalledOnce();

		workspace.state.createTableOpen = true;
		workspace.cancelWhenDialogsClose();
		workspace.state.running = undefined;
		workspace.state.createTableOpen = false;
		workspace.cancelWhenDialogsClose();
		expect(controllerMocks.cancel).toHaveBeenCalledOnce();
	});

	it('opens table and column editors against canonical schema objects', async () => {
		const { workspace } = setup();
		workspace.openTableEditor({ ...table } as never);
		await vi.waitFor(() => expect(workspace.state.running).toBeUndefined());
		expect(workspace.state.editorOpen).toBe(true);
		expect(workspace.state.editorTable).toEqual(table);
		expect(workspace.state.editorSnapshot).toEqual(snapshot);

		workspace.openColumnEditor(
			table as never,
			{ name: 'Message', type: 'string' } as never,
			'edit'
		);
		await vi.waitFor(() => expect(workspace.state.running).toBeUndefined());
		expect(workspace.state.columnEditorOpen).toBe(true);
		expect(workspace.state.columnMutationAction).toBe('edit');
	});

	it('ignores editor requests for entities absent from the active schema', () => {
		const { workspace } = setup();
		workspace.openTableEditor({ name: 'Missing', columns: [] } as never);
		workspace.openColumnEditor(
			table as never,
			{ name: 'Missing', type: 'string' } as never,
			'drop'
		);
		expect(workspace.isDialogOpen).toBe(false);
		expect(adapterMocks.prepareTable).not.toHaveBeenCalled();
	});

	it('refreshes and closes an editor when preflight finds a conflict', async () => {
		adapterMocks.prepareTable.mockResolvedValueOnce({ kind: 'conflict', conflicts: [] });
		const { workspace, refresh } = setup();
		workspace.openTableEditor(table as never);
		await vi.waitFor(() => expect(workspace.state.running).toBeUndefined());
		expect(refresh).toHaveBeenCalledWith('mock');
		expect(workspace.state.editorOpen).toBe(false);
		expect(workspace.state.mutationSuccess).toContain('table changed');
	});

	it('reports preflight errors and keeps mutation disabled', async () => {
		adapterMocks.prepareTable.mockRejectedValueOnce(new Error('Permission denied'));
		const { workspace } = setup();
		workspace.openTableEditor(table as never);
		await vi.waitFor(() => expect(workspace.state.running).toBeUndefined());
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

	it('is not left busy when a newer request supersedes an earlier one', async () => {
		const { workspace, setSchema } = setup();
		let finishPreparing!: (value: unknown) => void;
		adapterMocks.prepareTable.mockReturnValueOnce(
			new Promise((resolve) => (finishPreparing = resolve))
		);
		workspace.openTableEditor(table as never);
		expect(workspace.state.running).toBe('prepare-editor');

		workspace.openCreateTable();
		setSchema({
			Analytics: {
				name: 'Analytics',
				prettyName: 'Friendly analytics',
				tables: [table, { name: 'Created', columns: [] } as never],
				functions: []
			},
			Archive: { name: 'Archive', tables: [], functions: [] }
		});
		await workspace.createTable({ tableName: 'Created', summary: 'Create' } as never);
		finishPreparing({ kind: 'ready', snapshot });
		await vi.waitFor(() => expect(adapterMocks.prepareTable).toHaveBeenCalledOnce());
		await Promise.resolve();

		expect(workspace.state.createTableError).toBe('');
		expect(workspace.isBusy).toBe(false);
	});

	it('ignores a second drop of the same table while the first is running', async () => {
		const { workspace } = setup();
		let finishDrop!: (value: unknown) => void;
		adapterMocks.dropTable.mockReturnValueOnce(new Promise((resolve) => (finishDrop = resolve)));
		workspace.openDropTable(table as never);

		const first = workspace.removeTable();
		await workspace.removeTable();
		finishDrop({ mockSchemaRevision: 4 });
		await first;

		expect(adapterMocks.dropTable).toHaveBeenCalledOnce();
		expect(workspace.state.running).toBeUndefined();
	});

	it('reports table mutation command failures', async () => {
		const { workspace } = setup();
		workspace.openTableEditor(table as never);
		await vi.waitFor(() => expect(workspace.state.editorSnapshot).toBeDefined());
		adapterMocks.mutateTable.mockRejectedValueOnce(new Error('Command failed'));
		await workspace.updateTable({ summary: 'Rename' } as never);
		expect(workspace.state.mutationError).toBe('Command failed');
		expect(workspace.state.running).toBeUndefined();
	});

	it('refreshes the schema and drops the stale snapshot when only part of a change applied', async () => {
		const { workspace, refresh } = setup();
		workspace.openTableEditor(table as never);
		await vi.waitFor(() => expect(workspace.state.editorSnapshot).toBeDefined());
		refresh.mockClear();
		adapterMocks.mutateTable.mockRejectedValueOnce(
			new PartialSchemaMutationError('Id was renamed to EventId, but…')
		);

		await workspace.updateTable({ summary: 'Edit' } as never);

		expect(workspace.state.mutationError).toBe('Id was renamed to EventId, but…');
		expect(workspace.state.editorSnapshot).toBeUndefined();
		expect(workspace.state.editorOpen).toBe(true);
		expect(refresh).toHaveBeenCalledOnce();
		expect(workspace.state.running).toBeUndefined();
	});

	it('keeps the partial-change message when the follow-up refresh fails', async () => {
		const { workspace, refresh } = setup();
		workspace.openTableEditor(table as never);
		await vi.waitFor(() => expect(workspace.state.editorSnapshot).toBeDefined());
		adapterMocks.mutateTable.mockRejectedValueOnce(new PartialSchemaMutationError('Half done'));
		refresh.mockRejectedValueOnce(new Error('Refresh failed'));

		await expect(workspace.updateTable({ summary: 'Edit' } as never)).resolves.toBeUndefined();

		expect(workspace.state.mutationError).toBe('Half done');
	});

	it('ignores a failure from an update that a newer request replaced', async () => {
		const { workspace } = setup();
		workspace.openTableEditor(table as never);
		await vi.waitFor(() => expect(workspace.state.editorSnapshot).toBeDefined());
		let fail!: (error: Error) => void;
		adapterMocks.mutateTable.mockReturnValueOnce(
			new Promise((_resolve, reject) => {
				fail = reject;
			})
		);

		const update = workspace.updateTable({ summary: 'Edit' } as never);
		workspace.openTableEditor(table as never);
		fail(new Error('Late failure'));
		await update;

		expect(workspace.state.mutationError).toBe('');
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
		expect(workspace.state.running).toBeUndefined();
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
		expect(workspace.state.running).toBeUndefined();
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
		expect(workspace.isBusy).toBe(false);
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
