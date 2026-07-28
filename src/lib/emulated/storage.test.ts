import { describe, expect, it } from 'vitest';

import {
	createEmulatedStorage,
	getEmulatedStorage,
	normalizeEmulatedStorage,
	registerEmulatedStorage,
	unregisterEmulatedStorage
} from './storage';

describe('emulated cluster storage', () => {
	it('creates a stable OPFS descriptor from the cluster id', () => {
		expect(createEmulatedStorage('opfs', 'cluster-1')).toEqual({
			mode: 'opfs',
			storageId: 'cluster-1',
			formatVersion: 1
		});
	});

	it('defaults old or invalid stored connections to memory', () => {
		expect(normalizeEmulatedStorage(undefined, 'cluster-1')).toEqual({ mode: 'memory' });
		expect(normalizeEmulatedStorage({ mode: 'other' }, 'cluster-1')).toEqual({ mode: 'memory' });
	});

	it('repairs an incomplete OPFS descriptor with the stable cluster id', () => {
		expect(normalizeEmulatedStorage({ mode: 'opfs' }, 'cluster-1')).toEqual({
			mode: 'opfs',
			storageId: 'cluster-1',
			formatVersion: 1
		});
	});

	it('registers isolated runtime storage configuration', () => {
		registerEmulatedStorage('persistent', createEmulatedStorage('opfs', 'persistent'));
		expect(getEmulatedStorage('persistent').mode).toBe('opfs');
		expect(getEmulatedStorage('missing')).toEqual({ mode: 'memory' });

		unregisterEmulatedStorage('persistent');
		expect(getEmulatedStorage('persistent')).toEqual({ mode: 'memory' });
	});
});
