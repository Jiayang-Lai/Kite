import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

import ColumnActionsMenu from './column-actions-menu.svelte';

describe('ColumnActionsMenu', () => {
	it('publishes the selected column action after closing the menu', async () => {
		const onaction = vi.fn();
		const screen = await render(ColumnActionsMenu, {
			table: {
				name: 'Events',
				columns: [
					{ name: 'Message', type: 'string' },
					{ name: 'Timestamp', type: 'datetime' }
				]
			},
			column: { name: 'Message', type: 'string' },
			onaction
		});

		await screen.getByRole('button', { name: 'More actions for Events.Message' }).click();
		await screen.getByRole('menuitem', { name: 'Rename column' }).click();

		await vi.waitFor(() => expect(onaction).toHaveBeenCalledWith('rename'));
	});
});
