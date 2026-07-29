import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { once } from 'node:events';

const port = Number(process.env.KITE_MEMORY_PORT ?? 4174);
const origin = `http://127.0.0.1:${port}`;
const browserMarker = `kite-kusto-memory-${process.pid}`;
const mockClusterId = '5dd7fadc-c5b0-421f-8735-97000e9332ec';

function readProcessMemory() {
	if (!fs.existsSync('/proc')) return [];
	const processes = [];
	for (const name of fs.readdirSync('/proc')) {
		if (!/^\d+$/.test(name)) continue;
		try {
			const cmdline = fs.readFileSync(`/proc/${name}/cmdline`, 'utf8').replaceAll('\0', ' ');
			const status = fs.readFileSync(`/proc/${name}/status`, 'utf8');
			const parentPid = Number(status.match(/^PPid:\s+(\d+)/m)?.[1] ?? 0);
			processes.push({ pid: Number(name), parentPid, cmdline });
		} catch {
			// A process can end while collecting this snapshot.
		}
	}

	const trackedPids = new Set(
		processes
			.filter((process) => process.cmdline.includes(browserMarker))
			.map((process) => process.pid)
	);
	let changed = true;
	while (changed) {
		changed = false;
		for (const process of processes) {
			if (!trackedPids.has(process.pid) && trackedPids.has(process.parentPid)) {
				trackedPids.add(process.pid);
				changed = true;
			}
		}
	}

	return processes.flatMap((process) => {
		if (!trackedPids.has(process.pid)) return [];
		try {
			const smaps = fs.readFileSync(`/proc/${process.pid}/smaps_rollup`, 'utf8');
			const value = (field) =>
				Number(smaps.match(new RegExp(`^${field}:\\s+(\\d+)`, 'm'))?.[1] ?? 0);
			return [
				{
					pid: process.pid,
					type: process.cmdline.match(/--type=([^ ]+)/)?.[1] ?? 'browser',
					pssMb: value('Pss') / 1024,
					privateMb: (value('Private_Clean') + value('Private_Dirty')) / 1024
				}
			];
		} catch {
			return [];
		}
	});
}

async function workerHeaps(browser, workers) {
	const session = await browser.newBrowserCDPSession();
	const { targetInfos } = await session.send('Target.getTargets');
	const workerTargets = targetInfos.filter(
		(target) => target.type === 'worker' && workers.some((worker) => worker.url() === target.url)
	);

	return Promise.all(
		workerTargets.map(async (target) => {
			const { sessionId } = await session.send('Target.attachToTarget', {
				targetId: target.targetId
			});
			let requestId = 0;
			const send = (method) =>
				new Promise((resolve, reject) => {
					const id = ++requestId;
					const listener = (event) => {
						if (event.sessionId !== sessionId) return;
						const message = JSON.parse(event.message);
						if (message.id !== id) return;
						session.off('Target.receivedMessageFromTarget', listener);
						if (message.error) reject(new Error(message.error.message));
						else resolve(message.result);
					};
					session.on('Target.receivedMessageFromTarget', listener);
					void session
						.send('Target.sendMessageToTarget', {
							sessionId,
							message: JSON.stringify({ id, method })
						})
						.catch(reject);
				});
			await send('HeapProfiler.collectGarbage');
			const heap = await send('Runtime.getHeapUsage');
			await session.send('Target.detachFromTarget', { sessionId });
			return {
				url: target.url,
				usedHeapMb: heap.usedSize / 1024 / 1024,
				backingStorageMb: heap.backingStorageSize / 1024 / 1024
			};
		})
	);
}

async function snapshot(label, browser, page, cdp) {
	await page.waitForTimeout(1_000);
	await cdp.send('HeapProfiler.collectGarbage');
	const pageHeap = await cdp.send('Runtime.getHeapUsage');
	const workers = page.workers();
	const processes = readProcessMemory();
	const renderer = processes.find((process) => process.type === 'renderer');
	return {
		label,
		pageHeapMb: pageHeap.usedSize / 1024 / 1024,
		pageBackingStorageMb: pageHeap.backingStorageSize / 1024 / 1024,
		kustoWorkers: await workerHeaps(
			browser,
			workers.filter((worker) => worker.url().includes('kusto.worker'))
		),
		renderer,
		totalPssMb: processes.reduce((total, process) => total + process.pssMb, 0),
		processes
	};
}

function startPreview() {
	const command = process.platform === 'win32' ? 'npm.cmd' : 'npm';
	const preview = spawn(
		command,
		['run', 'preview', '--', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
		{
			stdio: ['ignore', 'pipe', 'pipe']
		}
	);
	const output = [];
	preview.stdout.on('data', (chunk) => output.push(chunk.toString()));
	preview.stderr.on('data', (chunk) => output.push(chunk.toString()));
	const exited = once(preview, 'exit');
	const started = new Promise((resolve, reject) => {
		const timeout = setTimeout(() => reject(new Error(output.join(''))), 15_000);
		preview.stdout.on('data', (chunk) => {
			if (!chunk.toString().includes('Local:')) return;
			clearTimeout(timeout);
			resolve();
		});
		preview.once('exit', (code) => {
			clearTimeout(timeout);
			reject(new Error(`Preview server exited early (${code}).\n${output.join('')}`));
		});
	});
	return { preview, started, exited };
}

const { preview, started, exited } = startPreview();
let browser;
try {
	await started;
	browser = await chromium.launch({
		headless: true,
		args: [
			`--${browserMarker}`,
			'--enable-precise-memory-info',
			'--js-flags=--expose-gc',
			'--no-sandbox'
		]
	});
	const context = await browser.newContext();
	await context.addCookies([{ name: 'kite_active_cluster_id', value: mockClusterId, url: origin }]);
	const page = await context.newPage();
	const cdp = await context.newCDPSession(page);

	await page.goto(`${origin}/explorer`);
	await page.getByRole('link', { name: 'Query workspace' }).waitFor();
	const results = [await snapshot('explorer', browser, page, cdp)];

	await page.getByRole('link', { name: 'Query workspace' }).click();
	await page.getByRole('heading', { name: 'Kite KQL Editor' }).waitFor();
	results.push(await snapshot('query-before-intellisense', browser, page, cdp));
	await page.locator('.monaco-editor').click({ position: { x: 24, y: 24 } });
	results.push(await snapshot('query-active', browser, page, cdp));

	await page.locator('a[href="/explorer"]').first().click();
	await page.getByRole('link', { name: 'Query workspace' }).waitFor();
	await page.waitForTimeout(9_000);
	results.push(await snapshot('explorer-after-query', browser, page, cdp));

	console.log(JSON.stringify(results, null, 2));
} finally {
	await browser?.close();
	preview.kill('SIGTERM');
	await exited.catch(() => undefined);
}
