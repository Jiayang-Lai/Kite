import { expect, test, type Page } from '@playwright/test';

function countDuckDbWorkers(page: Page) {
	return page.workers().filter((worker) => worker.url().includes('duckdb-browser-')).length;
}

function countKustoWorkers(page: Page) {
	return page.workers().filter((worker) => worker.url().includes('kusto.worker-')).length;
}

function countKqlTranslatorWorkers(page: Page) {
	return page.workers().filter((worker) => worker.url().includes('kql-translator.worker-')).length;
}

async function expectDuckDbWorkerCount(page: Page, count: number) {
	await expect.poll(() => countDuckDbWorkers(page)).toBe(count);
}

async function expectKustoWorkerCount(page: Page, count: number) {
	await expect.poll(() => countKustoWorkers(page), { timeout: 15_000 }).toBe(count);
}

async function expectKqlTranslatorWorkerCount(page: Page, count: number) {
	await expect.poll(() => countKqlTranslatorWorkers(page), { timeout: 15_000 }).toBe(count);
}

async function activateKustoIntelliSense(page: Page) {
	await page.locator('.monaco-editor').click({ position: { x: 24, y: 24 } });
}

test('serves the production build and opens the query explorer', async ({ page }) => {
	await page.goto('/');

	await expect(page).toHaveTitle('Kite');
	await expect(
		page.getByRole('heading', {
			name: 'Explore data and operate your local Kusto clusters.'
		})
	).toBeVisible();

	await page.getByRole('link', { name: 'Open Query Explorer' }).click();
	await expect(page).toHaveURL(/\/explorer\/query$/);
	await expect(page.getByRole('heading', { name: 'Kite KQL Editor' })).toBeVisible();
	await expectDuckDbWorkerCount(page, 0);
});

test('places the cluster switcher below its trigger on smaller displays', async ({ page }) => {
	await page.setViewportSize({ width: 600, height: 800 });
	await page.goto('/explorer/query');

	await page.getByRole('button', { name: 'Toggle cluster explorer' }).click();
	await page.getByRole('button', { name: /Mock cluster/ }).click();
	await expect(page.locator('[data-slot="dropdown-menu-content"]')).toHaveAttribute(
		'data-side',
		'bottom'
	);
});

test('translates KQL to DuckDB SQL and executes it in the browser', async ({ page }) => {
	const wasmLoader = await page.request.get('/kql-wasm/_framework/dotnet.js');
	test.skip(!wasmLoader.ok(), 'The local KQL WASM build is not present.');
	await page.goto('/labs/kql-to-sql');

	await expect(page).toHaveTitle('KQL to SQL WASM validation');
	await expect(page.getByTestId('duckdb-catalog')).toContainText('memory', {
		timeout: 30_000
	});
	await expect(page.getByTestId('duckdb-catalog')).toContainText('No user tables.');
	await expect(page.getByTestId('translation-output')).toContainText(
		"SELECT * FROM (VALUES ('Texas', CAST(12 AS BIGINT)), ('Ohio', CAST(8 AS BIGINT))) AS t(State, Events) ORDER BY Events DESC LIMIT 1",
		{ timeout: 30_000 }
	);
	const resultDrawer = page.getByTestId('duckdb-results');
	await expect(resultDrawer).toContainText('Run a duckdb query to see its results.');
	await page.getByRole('button', { name: 'Run query' }).click();
	await expect(resultDrawer.getByRole('cell', { name: 'Texas' })).toBeVisible({
		timeout: 30_000
	});
	await expect(resultDrawer.getByRole('cell', { name: '12' })).toBeVisible();
});

test('runs KQL through the emulated cluster and disables Kusto commands', async ({ page }) => {
	const wasmLoader = await page.request.get('/kql-wasm/_framework/dotnet.js');
	test.skip(!wasmLoader.ok(), 'The local KQL WASM build is not present.');
	await page.goto('/explorer/query');

	await page.getByRole('button', { name: /Mock cluster/ }).click();
	const emulatedClusterItem = page.getByRole('menuitem').filter({ hasText: 'Emulated cluster' });
	await emulatedClusterItem.hover();
	await expect(emulatedClusterItem).toHaveAttribute('data-state', 'instant-open');
	const clusterTooltip = page.getByRole('tooltip');
	await expect(clusterTooltip).toContainText('Emulated cluster');
	await expect(clusterTooltip).toContainText('KQL translated and executed in this browser tab');
	await emulatedClusterItem.click();
	await expect(page.getByText('memory', { exact: true }).first()).toBeVisible({
		timeout: 30_000
	});
	await page.getByRole('button', { name: 'Run' }).click();
	await expect(page.getByRole('cell', { name: 'Connected' })).toBeVisible({
		timeout: 30_000
	});
	await expectKqlTranslatorWorkerCount(page, 1);

	await page.goto('/admin/commands');
	await expect(
		page.getByRole('heading', {
			name: 'Management commands are not supported for emulated clusters'
		})
	).toBeVisible({ timeout: 30_000 });
	await expectKqlTranslatorWorkerCount(page, 0);
});

test('releases inactive DuckDB workers and keeps at most one emulated session', async ({
	page
}) => {
	test.setTimeout(60_000);
	await page.goto('/explorer/query');

	await page.getByRole('button', { name: /Mock cluster/ }).click();
	await page.getByRole('menuitem').filter({ hasText: 'Emulated cluster' }).click();
	await expect(page.getByText('memory', { exact: true }).first()).toBeVisible({
		timeout: 30_000
	});
	await expectDuckDbWorkerCount(page, 1);

	await page.getByRole('button', { name: /Emulated cluster/ }).click();
	await page.getByRole('menuitem').filter({ hasText: 'Mock cluster' }).click();
	await expect(page.getByRole('button', { name: /Mock cluster/ })).toBeVisible();
	await expectDuckDbWorkerCount(page, 0);

	await page.getByRole('button', { name: /Mock cluster/ }).click();
	await page.getByRole('menuitem').filter({ hasText: 'Emulated cluster' }).click();
	await expectDuckDbWorkerCount(page, 1);

	await page.getByRole('button', { name: /Emulated cluster/ }).click();
	await page.getByRole('menuitem', { name: 'Add cluster' }).click();
	const clusterDialog = page.getByRole('dialog', { name: 'Add cluster' });
	await clusterDialog.getByLabel('Name').fill('Second emulated cluster');
	await clusterDialog.locator('#new-cluster-kind').click();
	await page.getByRole('option', { name: 'Emulated' }).click();
	await clusterDialog.getByRole('button', { name: 'Add and connect' }).click();

	await expect(page.getByRole('button', { name: /Second emulated cluster Ephemeral/ })).toBeVisible(
		{
			timeout: 30_000
		}
	);
	await expectDuckDbWorkerCount(page, 1);

	await page.getByRole('link', { name: 'Kite', exact: true }).click();
	await expect(
		page.getByRole('heading', {
			name: 'Explore data and operate your local Kusto clusters.'
		})
	).toBeVisible();
	await expectDuckDbWorkerCount(page, 0);
});

test('releases the Kusto worker after leaving Query and recreates it for the next editor', async ({
	page
}) => {
	test.setTimeout(45_000);
	await page.goto('/explorer/query');
	await expect(page.getByRole('heading', { name: 'Kite KQL Editor' })).toBeVisible();
	await expectKustoWorkerCount(page, 0);
	await activateKustoIntelliSense(page);
	await expectKustoWorkerCount(page, 1);

	await page.locator('a[href="/explorer"]').first().click();
	await expect(page.getByRole('link', { name: 'Query workspace' })).toBeVisible();
	await expectKustoWorkerCount(page, 0);

	await page.getByRole('link', { name: 'Query workspace' }).click();
	await expect(page.getByRole('heading', { name: 'Kite KQL Editor' })).toBeVisible();
	await activateKustoIntelliSense(page);
	await expectKustoWorkerCount(page, 1);
});

test('creates DuckDB databases and tables from emulated cluster administration', async ({
	page
}) => {
	test.setTimeout(90_000);
	await page.goto('/admin/databases');
	await page.getByRole('button', { name: /Mock cluster/ }).click();
	await page.getByRole('menuitem').filter({ hasText: 'Emulated cluster' }).click();
	await expect(page.getByText('memory', { exact: true }).first()).toBeVisible({
		timeout: 30_000
	});

	await page.getByRole('button', { name: 'New', exact: true }).click();
	const databaseDialog = page.getByRole('dialog', { name: 'Create database' });
	await databaseDialog.getByLabel('Database name').fill('Analytics');
	await databaseDialog.getByRole('button', { name: 'Create database' }).click();
	await expect(page.getByText('Analytics', { exact: true }).first()).toBeVisible();

	await page.getByRole('button', { name: 'New table' }).click();
	const tableDialog = page.getByRole('dialog', { name: 'New table' });
	await tableDialog.getByLabel('Table name').fill('Events');
	await tableDialog.getByLabel('Column name').fill('State');
	await tableDialog.getByRole('button', { name: 'Review table' }).click();
	await tableDialog.getByLabel(/Type CREATE Events to confirm/).fill('CREATE Events');
	await tableDialog.getByRole('button', { name: 'Create table' }).click();

	await expect(page.getByText('Events', { exact: true }).first()).toBeVisible();
	await expect(page.getByText('State', { exact: true }).first()).toBeVisible();

	await page.getByRole('button', { name: 'Events 1 column' }).click();
	await page.getByRole('button', { name: 'Edit table' }).click();
	const editDialog = page.getByRole('dialog', { name: 'Edit Events' });
	await editDialog.getByLabel('Description').fill('Event rows');
	await editDialog.getByRole('button', { name: 'Add column' }).click();
	await editDialog.getByLabel('Column name').fill('Count');
	await editDialog.getByRole('button', { name: 'Review changes' }).click();
	const reviewEditDialog = page.getByRole('dialog', { name: 'Review table update' });
	await reviewEditDialog.locator('#confirm-table-update').fill('RUN');
	await reviewEditDialog.getByRole('button', { name: 'Update table' }).click();
	await expect(page.getByText('Count', { exact: true }).first()).toBeVisible();

	await page.getByRole('link', { name: 'Data ingestion' }).click();
	const ingestionWorkspace = page.getByRole('main');
	await expect(ingestionWorkspace.locator('[data-emulated-storage="ephemeral"]')).toBeVisible();
	await expect(ingestionWorkspace.getByText('Ephemeral', { exact: true })).toBeVisible();
	await page.locator('#ingestion-database').click();
	await page.getByRole('option', { name: 'Analytics' }).click();
	await page.locator('#ingestion-table').click();
	await page.getByRole('option', { name: 'Events' }).click();
	await page.getByLabel('CSV rows').fill('Texas,12\nOhio,8');
	await page.getByRole('button', { name: 'Review ingestion' }).click();
	let ingestionDialog = page.getByRole('dialog', { name: 'Ingest data into Events?' });
	await ingestionDialog.getByLabel('Type RUN to enable ingestion').fill('RUN');
	await ingestionDialog.getByRole('button', { name: 'Ingest data' }).click();
	await expect(page.getByRole('cell', { name: '2', exact: true })).toBeVisible();

	await page.getByRole('tab', { name: 'Local file' }).click();
	await page.locator('#inline-file-input').setInputFiles({
		name: 'more-events.csv',
		mimeType: 'text/csv',
		buffer: Buffer.from('State,Count\nNevada,3\n')
	});
	const reviewIngestionButton = page.getByRole('button', { name: 'Review ingestion' });
	await expect(reviewIngestionButton).toBeEnabled();
	await reviewIngestionButton.click();
	ingestionDialog = page.getByRole('dialog', { name: 'Ingest data into Events?' });
	await ingestionDialog.getByLabel('Type RUN to enable ingestion').fill('RUN');
	await ingestionDialog.getByRole('button', { name: 'Ingest data' }).click();
	await expect(page.getByRole('cell', { name: '1', exact: true })).toBeVisible();

	await page.getByRole('link', { name: 'Databases & tables' }).click();
	await expect(page.getByText('Analytics', { exact: true }).first()).toBeVisible();
	const eventsButton = page.getByRole('button', { name: 'Events 2 columns' });
	if ((await eventsButton.getAttribute('aria-expanded')) !== 'true') await eventsButton.click();
	await page.getByRole('button', { name: 'Remove table' }).click();
	const removeTableDialog = page.getByRole('dialog', { name: 'Remove table' });
	await removeTableDialog.getByLabel(/Type REMOVE Events to confirm/).fill('REMOVE Events');
	await removeTableDialog.getByRole('button', { name: 'Remove table' }).click();
	await expect(page.getByText('Table Analytics.Events removed.')).toBeVisible();
	await expect(removeTableDialog).toBeHidden();

	await page.getByRole('button', { name: 'Analytics 0 tables' }).hover();
	await page.getByRole('button', { name: 'More actions for database Analytics' }).click();
	await page.getByRole('menuitem', { name: 'Delete database' }).click();
	const removeDatabaseDialog = page.getByRole('dialog', { name: 'Delete database' });
	await removeDatabaseDialog.getByLabel(/Type Analytics to confirm/).fill('Analytics');
	await removeDatabaseDialog.getByRole('button', { name: 'Delete database' }).click();
	await expect(page.getByText('Database Analytics deleted.')).toBeVisible();
});

test('reopens a persistent custom emulated cluster after a full reload', async ({ page }) => {
	test.setTimeout(90_000);
	await page.goto('/admin/databases');

	await page.getByRole('button', { name: /Mock cluster/ }).click();
	await page.getByRole('menuitem', { name: 'Add cluster' }).click();
	const clusterDialog = page.getByRole('dialog', { name: 'Add cluster' });
	await clusterDialog.getByLabel('Name').fill('Persistent DuckDB');
	await clusterDialog.locator('#new-cluster-kind').click();
	await page.getByRole('option', { name: 'Emulated' }).click();
	await clusterDialog.locator('#new-cluster-storage').click();
	await page.getByRole('option', { name: 'Persistent browser storage' }).click();
	await clusterDialog.getByRole('button', { name: 'Add and connect' }).click();

	await expect(page.getByRole('button', { name: /Persistent DuckDB Persistent/ })).toBeVisible();
	await expect(page.getByText('memory', { exact: true }).first()).toBeVisible({
		timeout: 30_000
	});
	await page.getByRole('button', { name: 'New table' }).click();
	const tableDialog = page.getByRole('dialog', { name: 'New table' });
	await tableDialog.getByLabel('Table name').fill('PersistentEvents');
	await tableDialog.getByLabel('Column name').fill('State');
	await tableDialog.getByRole('button', { name: 'Review table' }).click();
	await tableDialog
		.getByLabel(/Type CREATE PersistentEvents to confirm/)
		.fill('CREATE PersistentEvents');
	await tableDialog.getByRole('button', { name: 'Create table' }).click();
	await expect(page.getByText('PersistentEvents', { exact: true }).first()).toBeVisible();

	await page.getByRole('button', { name: /Persistent DuckDB Persistent/ }).click();
	await page.getByRole('menuitem').filter({ hasText: 'Mock cluster' }).click();
	await expectDuckDbWorkerCount(page, 0);

	await page.getByRole('button', { name: /Mock cluster/ }).click();
	await page.getByRole('menuitem').filter({ hasText: 'Persistent DuckDB' }).click();
	await expect(page.getByRole('button', { name: 'PersistentEvents 1 column' })).toBeVisible({
		timeout: 30_000
	});
	await expectDuckDbWorkerCount(page, 1);

	await page.reload();

	await expect(page.getByRole('button', { name: /Persistent DuckDB Persistent/ })).toBeVisible({
		timeout: 30_000
	});
	await expect(page.getByRole('button', { name: 'PersistentEvents 1 column' })).toBeVisible({
		timeout: 30_000
	});
});
