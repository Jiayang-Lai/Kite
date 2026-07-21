const workerGlobal = globalThis as typeof globalThis & { global?: typeof globalThis };

// Bridge.NET's browser bundle still expects Node's global alias to exist.
workerGlobal.global ??= globalThis;
