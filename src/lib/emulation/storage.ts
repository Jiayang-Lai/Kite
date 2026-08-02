export type EmulatedStorage =
	| {
			mode: 'memory';
	  }
	| {
			mode: 'opfs';
			storageId: string;
			formatVersion: 1;
	  };

export type EmulatedStorageMode = EmulatedStorage['mode'];

const MEMORY_STORAGE: EmulatedStorage = { mode: 'memory' };
const storageByClusterId = new Map<string, EmulatedStorage>();

export function createEmulatedStorage(
	mode: EmulatedStorageMode,
	clusterId: string
): EmulatedStorage {
	return mode === 'opfs'
		? {
				mode,
				storageId: clusterId,
				formatVersion: 1
			}
		: MEMORY_STORAGE;
}

export function normalizeEmulatedStorage(value: unknown, clusterId: string): EmulatedStorage {
	if (!value || typeof value !== 'object') return MEMORY_STORAGE;
	const storage = value as Record<string, unknown>;
	if (
		storage.mode === 'opfs' &&
		typeof storage.storageId === 'string' &&
		storage.storageId.trim() &&
		storage.formatVersion === 1
	) {
		return {
			mode: 'opfs',
			storageId: storage.storageId,
			formatVersion: 1
		};
	}
	if (storage.mode === 'opfs') return createEmulatedStorage('opfs', clusterId);
	return MEMORY_STORAGE;
}

export function registerEmulatedStorage(clusterId: string, storage?: EmulatedStorage) {
	storageByClusterId.set(clusterId, storage ?? MEMORY_STORAGE);
}

export function unregisterEmulatedStorage(clusterId: string) {
	storageByClusterId.delete(clusterId);
}

export function getEmulatedStorage(clusterId: string): EmulatedStorage {
	return storageByClusterId.get(clusterId) ?? MEMORY_STORAGE;
}

export function isPersistentEmulatedStorage(storage?: EmulatedStorage) {
	return storage?.mode === 'opfs';
}
