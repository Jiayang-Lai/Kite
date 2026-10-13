import { expect, test as base } from '@playwright/test';

// Served by the preview-only plugin in vite.config.ts; absent on external servers.
const CSP_REPORTS_PATH = '/__kite/csp-reports';
const REPORT_DELIVERY_GRACE_MS = 2_000;
/**
 * Annotation for a violation a test is known to trigger, described as "<directive> <blocked>",
 * for example "script-src eval". Each use must explain the source and stay until it is fixed.
 */
export const CSP_KNOWN_VIOLATION = 'csp-known-violation';

type Violation = { directive: string; blocked: string; sourceFile: string; sample?: string };

const violationKey = ({ directive, blocked, sourceFile }: Violation) =>
	`${directive} ${blocked || 'inline'} ${sourceFile}`;

// Page violations seen by any test in this Playwright worker. The worker-scoped report check uses
// it to leave page violations to the per-test check, which can attribute and allow them.
const pageViolationKeys = new Set<string>();

/**
 * Fails tests that trigger a Content Security Policy report. The deployed policy is Report-Only,
 * so violations would otherwise pass silently; `vite preview` serves the same generated policy.
 *
 * Page violations are checked per test. Web workers (DuckDB, the KQL translator, Monaco) report
 * only through `report-uri`, which is checked once per Playwright worker so tests do not each
 * wait for asynchronous report delivery.
 */
export const test = base.extend<
	{ pageContentSecurityPolicy: void },
	{ reportedContentSecurityPolicy: void }
>({
	reportedContentSecurityPolicy: [
		async ({ playwright }, use, workerInfo) => {
			const request = await playwright.request.newContext({
				baseURL: workerInfo.project.use.baseURL
			});
			const cleared = await request.delete(CSP_REPORTS_PATH).catch(() => undefined);
			const available = Boolean(
				cleared?.ok() && cleared.headers()['content-type']?.includes('json')
			);

			await use();

			if (available) {
				await new Promise((resolve) => setTimeout(resolve, REPORT_DELIVERY_GRACE_MS));
				const reports = (await (await request.get(CSP_REPORTS_PATH)).json()) as {
					'csp-report'?: Record<string, string>;
				}[];
				const workerViolations = new Set(
					reports
						.map(({ 'csp-report': report = {} }) =>
							violationKey({
								directive: report['effective-directive'],
								blocked: report['blocked-uri'],
								sourceFile: report['source-file'] || report['document-uri']
							})
						)
						.filter((key) => !pageViolationKeys.has(key))
				);
				expect([...workerViolations], 'Content Security Policy reports from workers').toEqual([]);
			}
			await request.dispose();
		},
		{ scope: 'worker', auto: true }
	],
	pageContentSecurityPolicy: [
		async ({ page }, use, testInfo) => {
			const violations: Violation[] = [];
			// A binding survives navigations, unlike state stored on window.
			await page.exposeBinding('__kiteReportCspViolation', (_source, violation: Violation) => {
				violations.push(violation);
				pageViolationKeys.add(violationKey(violation));
			});
			await page.addInitScript(() => {
				document.addEventListener('securitypolicyviolation', (event) => {
					void (
						window as unknown as Record<string, (violation: unknown) => void>
					).__kiteReportCspViolation?.({
						directive: event.effectiveDirective,
						blocked: event.blockedURI,
						sourceFile: event.sourceFile,
						sample: event.sample
					});
				});
			});

			await use();

			const allowed = new Set(
				testInfo.annotations
					.filter((annotation) => annotation.type === CSP_KNOWN_VIOLATION)
					.map((annotation) => annotation.description?.split(' — ')[0])
			);
			const unexpected = new Set(
				violations
					.filter(({ directive, blocked }) => !allowed.has(`${directive} ${blocked || 'inline'}`))
					.map(
						(violation) => `${violationKey(violation)} sample=${JSON.stringify(violation.sample)}`
					)
			);
			expect([...unexpected], 'Content Security Policy violations').toEqual([]);
		},
		{ auto: true }
	]
});

export { expect };
