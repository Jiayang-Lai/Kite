// Monaco-Kusto's manager keeps a worker forever by default and serializes its
// complete schema back from the worker before stopping it. Kite already owns the
// source schema, so this adapted manager can terminate safely and rehydrate from
// the next editor mount instead.
// @ts-nocheck
import type * as monaco from 'monaco-editor/esm/vs/editor/editor.api';

export class KustoWorkerManager {
	private _workerDetails: unknown = null;
	private _workerDetailsPromise: Promise<unknown> | null = null;
	private _disposing: Promise<void> | null = null;
	private _pendingRequests = 0;
	private _disposed = false;
	private _idleCheckInterval: number;
	private _configChangeListener: { dispose(): void };

	constructor(
		private _monacoInstance: typeof monaco,
		private _defaults: {
			languageSettings: unknown;
			onDidChange: (listener: () => void) => { dispose(): void };
			getWorkerMaxIdleTime: () => number;
		}
	) {
		this._idleCheckInterval = self.setInterval(() => this._checkIfIdle(), 30_000);
		this._configChangeListener = this._defaults.onDidChange(() => void this.disposeWorker());
	}

	trackRequest<T>(request: Promise<T>): Promise<T> {
		this._pendingRequests += 1;
		return request.finally(() => {
			this._pendingRequests -= 1;
		});
	}

	async disposeWorker() {
		if (this._disposing) return this._disposing;

		const details = this._workerDetails as { _worker?: { dispose(): void } } | null;
		this._workerDetails = null;
		this._workerDetailsPromise = null;
		if (!details?._worker) return;

		this._disposing = (async () => {
			const deadline = Date.now() + 1_500;
			while (this._pendingRequests > 0 && Date.now() < deadline) {
				await new Promise((resolve) => setTimeout(resolve, 25));
			}
			details._worker?.dispose();
		})().finally(() => {
			this._disposing = null;
		});

		return this._disposing;
	}

	dispose() {
		this._disposed = true;
		clearInterval(this._idleCheckInterval);
		this._configChangeListener.dispose();
		return this.disposeWorker();
	}

	async getLanguageServiceWorker(...resources: monaco.Uri[]) {
		if (this._disposed) throw new Error('The Kusto worker manager has been disposed.');
		if (this._disposing) await this._disposing;

		const details = await this._getClient();
		details._lastUsedTime = Date.now();
		await details._worker.withSyncedResources(resources);
		return details._client;
	}

	private _checkIfIdle() {
		const details = this._workerDetails as { _lastUsedTime?: number } | null;
		if (!details) return;

		const maxIdleTime = this._defaults.getWorkerMaxIdleTime();
		if (maxIdleTime > 0 && Date.now() - (details._lastUsedTime ?? 0) > maxIdleTime) {
			void this.disposeWorker();
		}
	}

	private _getClient() {
		if (!this._workerDetailsPromise) {
			const languageSettings = { ...(this._defaults.languageSettings as object) } as Record<
				string,
				unknown
			>;
			delete languageSettings.onDidProvideCompletionItems;
			const createData = { languageSettings, languageId: 'kusto' };
			const workerPromise = this._resolveWorker().then((worker) => {
				worker.postMessage('ignore');
				worker.postMessage(createData);
				return worker;
			});
			const worker = this._monacoInstance.editor.createWebWorker({
				worker: workerPromise,
				keepIdleModels: false
			});
			const client = worker.getProxy();
			this._workerDetailsPromise = client.then((resolvedClient) => {
				const details = {
					_worker: worker,
					_client: resolvedClient,
					_lastUsedTime: Date.now()
				};
				this._workerDetails = details;
				return details;
			});
		}

		return this._workerDetailsPromise;
	}

	private async _resolveWorker() {
		const environment = globalThis.MonacoEnvironment;
		if (environment && typeof environment.getWorker === 'function') {
			return environment.getWorker('workerMain.js', 'kusto');
		}
		if (environment && typeof environment.getWorkerUrl === 'function') {
			return new Worker(environment.getWorkerUrl('workerMain.js', 'kusto'), { name: 'kusto' });
		}
		throw new Error('MonacoEnvironment must route the kusto worker.');
	}
}
