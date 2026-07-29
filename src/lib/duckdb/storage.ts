export function getPersistentDuckDbFilePrefix(storageId: string) {
	const token = Array.from(new TextEncoder().encode(storageId), (byte) =>
		byte.toString(16).padStart(2, '0')
	).join('');
	return `kite-v1-${token}-`;
}

/** Permanently removes the OPFS files owned by one persistent emulated cluster. */
export async function deletePersistentDuckDbStorage(storageId: string) {
	if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) {
		throw new Error('Persistent browser storage is not available.');
	}

	const root = await navigator.storage.getDirectory();
	const prefix = getPersistentDuckDbFilePrefix(storageId);
	const directory = root as FileSystemDirectoryHandle & {
		entries: () => AsyncIterableIterator<[string, FileSystemHandle]>;
	};
	for await (const [name] of directory.entries()) {
		if (name.startsWith(prefix)) await root.removeEntry(name);
	}
}
