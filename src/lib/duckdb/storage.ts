export function getPersistentDuckDbFilePrefix(storageId: string) {
	const token = Array.from(new TextEncoder().encode(storageId), (byte) =>
		byte.toString(16).padStart(2, '0')
	).join('');
	return `kite-v1-${token}-`;
}

const OPFS_DELETE_RETRY_DELAY_MS = 25;
const OPFS_DELETE_RETRY_COUNT = 40;

function waitForOpfsHandleRelease() {
	return new Promise<void>((resolve) => setTimeout(resolve, OPFS_DELETE_RETRY_DELAY_MS));
}

async function removePersistentEntry(root: FileSystemDirectoryHandle, name: string) {
	for (let attempt = 0; ; attempt++) {
		try {
			await root.removeEntry(name);
			return;
		} catch (cause) {
			if (
				!(cause instanceof DOMException) ||
				cause.name !== 'NoModificationAllowedError' ||
				attempt === OPFS_DELETE_RETRY_COUNT
			) {
				throw cause;
			}
			// Worker termination resolves before Chromium has released every OPFS sync handle.
			await waitForOpfsHandleRelease();
		}
	}
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
		if (name.startsWith(prefix)) await removePersistentEntry(root, name);
	}
}
