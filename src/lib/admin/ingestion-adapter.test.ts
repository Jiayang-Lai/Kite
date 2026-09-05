import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	startEmulatedIngestion: vi.fn(),
	startKustoManagementCommand: vi.fn()
}));

vi.mock('$lib/emulation/data-ingestion', () => ({
	startEmulatedIngestion: mocks.startEmulatedIngestion
}));
vi.mock('$lib/kusto/query-client', () => ({
	getKustoErrorMessage: (error: unknown) =>
		error instanceof Error ? error.message : String(error),
	startKustoManagementCommand: mocks.startKustoManagementCommand
}));

import { formatIngestionError, startIngestion } from './ingestion-adapter';

describe('ingestion adapter', () => {
	beforeEach(() => vi.clearAllMocks());

	it('dispatches emulated and Kustainer requests through one contract', () => {
		const execution = { promise: Promise.resolve({}), cancel: vi.fn() };
		mocks.startEmulatedIngestion.mockReturnValue(execution);
		mocks.startKustoManagementCommand.mockReturnValue(execution);
		const emulatedRequest = {
			clusterId: 'cluster',
			database: 'db',
			table: 'events',
			format: 'csv' as const,
			source: { kind: 'inline' as const, data: 'value' }
		};

		expect(startIngestion({ kind: 'emulated', request: emulatedRequest })).toBe(execution);
		expect(mocks.startEmulatedIngestion).toHaveBeenCalledWith(emulatedRequest);
		expect(
			startIngestion({
				kind: 'kustainer',
				database: 'db',
				command: '.ingest inline into table events <| value',
				clusterUrl: 'http://localhost:8080'
			})
		).toBe(execution);
		expect(mocks.startKustoManagementCommand).toHaveBeenCalledWith(
			'db',
			'.ingest inline into table events <| value',
			'http://localhost:8080'
		);
	});

	it('normalizes provider-specific cancellation messages', () => {
		expect(formatIngestionError(new Error('Command cancelled.'), 'emulated')).toContain(
			'DuckDB rolled back'
		);
		expect(formatIngestionError(new Error('Command cancelled.'), 'kustainer')).toContain(
			'may still complete'
		);
	});
});
