import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

import type { QueryTab } from '$lib/cluster/cluster-session.svelte';

import QueryTabBar from './query-tab-bar.svelte';

const firstTab: QueryTab = {
	id: 'first',
	database: 'Samples',
	query: 'Events | count',
	isRunning: false
};
const secondTab: QueryTab = {
	id: 'second',
	database: 'Samples',
	query: 'Events | take 10',
	isRunning: false
};
const thirdTab: QueryTab = {
	id: 'third',
	database: 'Other',
	query: '',
	isRunning: false
};

function createProps() {
	return {
		tabs: [firstTab, secondTab, thirdTab],
		activeTab: firstTab,
		originalTab: undefined,
		modifiedTab: firstTab,
		compareCandidates: [secondTab],
		schemaCollapsed: false,
		canSave: true,
		saveTitle: 'Save query locally',
		isRunning: false,
		canRun: true,
		runTitle: 'Run query (Shift+Enter)',
		titleFor: (tab: QueryTab) => `Query ${tab.id}`,
		isDirty: (tab: QueryTab) => tab.id === firstTab.id,
		onselect: vi.fn(),
		oncompare: vi.fn(),
		onclose: vi.fn(),
		oncreate: vi.fn(),
		ontogglecomparison: vi.fn(),
		ontoggleschema: vi.fn(),
		onsave: vi.fn(),
		onrun: vi.fn(),
		oncancel: vi.fn()
	};
}

describe('QueryTabBar', () => {
	it('routes tab and toolbar interactions to the workspace', async () => {
		const props = createProps();
		const screen = await render(QueryTabBar, props);

		await expect.element(screen.getByText('Unsaved changes')).toBeInTheDocument();
		const secondTabButton = screen
			.getByRole('tab', { name: 'Query second' })
			.element()
			.querySelector('button');
		expect(secondTabButton).not.toBeNull();
		secondTabButton?.click();
		expect(props.onselect).toHaveBeenCalledWith(secondTab);

		secondTabButton?.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));
		expect(props.oncompare).toHaveBeenCalledWith(secondTab);

		await screen.getByRole('button', { name: 'Close Query second' }).click();
		await screen.getByRole('button', { name: 'New query tab' }).click();
		await screen.getByRole('button', { name: 'Hide database schema' }).click();
		await screen.getByRole('button', { name: 'Compare' }).click();
		await screen.getByRole('button', { name: 'Save', exact: true }).click();
		await screen.getByRole('button', { name: 'Run' }).click();

		expect(props.onclose).toHaveBeenCalledWith(secondTab);
		expect(props.oncreate).toHaveBeenCalledOnce();
		expect(props.ontoggleschema).toHaveBeenCalledOnce();
		expect(props.ontogglecomparison).toHaveBeenCalledOnce();
		expect(props.onsave).toHaveBeenCalledOnce();
		expect(props.onrun).toHaveBeenCalledOnce();
	});

	it('represents comparison, locked-tab, collapsed-schema, and running states', async () => {
		const props = createProps();
		const screen = await render(QueryTabBar, {
			...props,
			activeTab: secondTab,
			originalTab: firstTab,
			modifiedTab: secondTab,
			schemaCollapsed: true,
			canSave: false,
			isRunning: true
		});

		await expect
			.element(screen.getByRole('tab', { name: 'Query first, comparison original' }))
			.toBeVisible();
		await expect
			.element(screen.getByRole('tab', { name: 'Query second, comparison modified' }))
			.toBeVisible();
		await expect
			.element(screen.getByRole('tab', { name: 'Query third' }))
			.toHaveAttribute('aria-disabled', 'true');
		await expect.element(screen.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();

		await screen.getByRole('button', { name: 'Show database schema' }).click();
		await screen.getByRole('button', { name: 'Close diff' }).click();
		await screen.getByRole('button', { name: 'Cancel' }).click();
		expect(props.ontoggleschema).toHaveBeenCalledOnce();
		expect(props.ontogglecomparison).toHaveBeenCalledOnce();
		expect(props.oncancel).toHaveBeenCalledOnce();
	});

	it('supports wheel and pointer dragging when the tab list overflows', async () => {
		const screen = await render(QueryTabBar, createProps());
		const tabList = screen.getByRole('tablist').element() as HTMLDivElement;
		Object.defineProperties(tabList, {
			clientWidth: { configurable: true, value: 100 },
			scrollWidth: { configurable: true, value: 400 },
			scrollLeft: { configurable: true, value: 0, writable: true }
		});
		Object.defineProperty(tabList, 'scrollBy', { configurable: true, value: vi.fn() });
		Object.defineProperty(tabList, 'setPointerCapture', { configurable: true, value: vi.fn() });
		Object.defineProperty(tabList, 'releasePointerCapture', { configurable: true, value: vi.fn() });

		const wheel = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 24 });
		tabList.dispatchEvent(wheel);
		expect(wheel.defaultPrevented).toBe(true);
		expect(tabList.scrollBy).toHaveBeenCalledWith({ left: 24 });

		tabList.scrollLeft = 10;
		tabList.dispatchEvent(new Event('scroll'));
		await screen.getByRole('button', { name: 'Show earlier query tabs' }).click();
		await screen.getByRole('button', { name: 'Show later query tabs' }).click();
		expect(tabList.scrollBy).toHaveBeenCalledWith({ left: -65, behavior: 'smooth' });
		expect(tabList.scrollBy).toHaveBeenCalledWith({ left: 65, behavior: 'smooth' });

		tabList.dispatchEvent(
			new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 7, clientX: 80 })
		);
		tabList.dispatchEvent(
			new PointerEvent('pointermove', { bubbles: true, pointerId: 7, clientX: 40 })
		);
		tabList.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 7 }));
		expect(tabList.setPointerCapture).toHaveBeenCalledWith(7);
		expect(tabList.releasePointerCapture).toHaveBeenCalledWith(7);
		expect(tabList.setPointerCapture).toHaveBeenCalledOnce();
	});
});
