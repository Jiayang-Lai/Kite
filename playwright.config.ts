import { defineConfig } from '@playwright/test';

const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:4173';
const useExternalServer = process.env.PLAYWRIGHT_EXTERNAL_SERVER === 'true';

export default defineConfig({
	use: {
		baseURL: baseUrl
	},
	webServer: useExternalServer
		? undefined
		: {
				command: 'npm run preview -- --host 127.0.0.1',
				url: baseUrl,
				reuseExistingServer: !process.env.CI
			},
	testMatch: '**/*.e2e.{ts,js}'
});
