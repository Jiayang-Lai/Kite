const options = parseOptions(process.argv.slice(2));
const target = new URL(options.url);
let lastError;

for (let attempt = 1; attempt <= options.attempts; attempt++) {
	try {
		const response = await fetch(target, {
			headers: { 'user-agent': 'Kite deployment smoke test' },
			redirect: 'follow',
			signal: AbortSignal.timeout(options.timeout)
		});
		const body = await response.text();

		if (!response.ok) {
			throw new Error(`HTTP ${response.status} ${response.statusText}`);
		}
		if (!/<title[^>]*>\s*Kite\s*<\/title>/i.test(body)) {
			throw new Error('The response does not contain the expected Kite page title.');
		}

		const translatorResponse = await fetch(new URL('/kql-wasm/_framework/dotnet.js', target), {
			headers: { 'user-agent': 'Kite deployment smoke test' },
			redirect: 'follow',
			signal: AbortSignal.timeout(options.timeout)
		});
		const contentType = translatorResponse.headers.get('content-type') ?? '';
		if (!translatorResponse.ok || !/javascript|ecmascript/i.test(contentType)) {
			throw new Error(
				`KQL translator loader is unavailable or incorrectly served (${translatorResponse.status} ${contentType}).`
			);
		}

		console.log(`Smoke test passed for ${target.href} on attempt ${attempt}.`);
		process.exit(0);
	} catch (error) {
		lastError = error;
		console.warn(`Smoke test attempt ${attempt}/${options.attempts} failed: ${error.message}`);
		if (attempt < options.attempts) {
			await new Promise((resolve) => setTimeout(resolve, options.delay));
		}
	}
}

throw new Error(`Smoke test failed for ${target.href}: ${lastError?.message ?? 'unknown error'}`);

function parseOptions(arguments_) {
	const values = {
		url: '',
		// Cloudflare Pages can acknowledge a deployment before every asset is reachable.
		// Allow enough time for the production edge to converge before failing the release.
		attempts: 12,
		delay: 10_000,
		timeout: 15_000
	};

	for (let index = 0; index < arguments_.length; index += 2) {
		const option = arguments_[index];
		const value = arguments_[index + 1];
		if (!option?.startsWith('--') || value === undefined) {
			throw new Error(`Invalid option: ${option ?? ''}`);
		}
		const key = option.slice(2);
		if (!Object.hasOwn(values, key)) {
			throw new Error(`Unknown option: ${option}`);
		}
		values[key] = key === 'url' ? value : Number(value);
	}

	if (!values.url) {
		throw new Error('Usage: smoke-test.mjs --url <https://deployment.example>');
	}
	if (
		!Number.isInteger(values.attempts) ||
		values.attempts < 1 ||
		!Number.isFinite(values.delay) ||
		values.delay < 0 ||
		!Number.isFinite(values.timeout) ||
		values.timeout < 1
	) {
		throw new Error('Smoke-test retry options must be positive numbers.');
	}

	return values;
}
