import type { KustoApi } from './runtime';

const RELEASE_GRACE_PERIOD_MS = 8_000;

let activeEditorLeases = 0;
let releaseTimer: ReturnType<typeof setTimeout> | undefined;
let runtime: KustoApi | undefined;

function cancelScheduledRelease() {
	if (!releaseTimer) return;
	clearTimeout(releaseTimer);
	releaseTimer = undefined;
}

function scheduleRelease() {
	cancelScheduledRelease();
	releaseTimer = setTimeout(() => {
		releaseTimer = undefined;
		if (activeEditorLeases !== 0) return;
		void runtime?.disposeKustoWorker();
	}, RELEASE_GRACE_PERIOD_MS);
}

/**
 * Keeps Monaco-Kusto's language worker alive only while a Kite editor exists.
 * A short grace period avoids reparsing the language engine during a quick route
 * bounce; the next editor mount always reapplies its schema from Kite state.
 */
export function retainKustoWorker(nextRuntime: KustoApi) {
	runtime = nextRuntime;
	activeEditorLeases += 1;
	cancelScheduledRelease();

	let released = false;
	return () => {
		if (released) return;
		released = true;
		activeEditorLeases = Math.max(0, activeEditorLeases - 1);
		if (activeEditorLeases === 0) scheduleRelease();
	};
}

export const kustoWorkerReleaseGracePeriodMs = RELEASE_GRACE_PERIOD_MS;
