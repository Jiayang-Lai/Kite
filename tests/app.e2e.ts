import { expect, test } from '@playwright/test';

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
});
