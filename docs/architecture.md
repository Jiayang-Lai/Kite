# Architecture and implementation

Kite is a browser-first Kusto workspace. It is a SvelteKit single-page application that lets a user work with one of four connection kinds: a browser-emulated Kusto-compatible cluster, a mock catalog, a local Kustainer-compatible Kusto endpoint, or Azure Log Analytics. Most application state and all browser-local data stay in the browser; the application only calls the configured Kusto or Log Analytics endpoints when a connection requires one.

## System overview

```text
SvelteKit routes and Svelte components
        |
        +-- shared application stores (connections, session, saved/recent queries)
        |
        +-- ConnectionRuntime
        |     +-- mock schema
        |     +-- DuckDB-WASM + KQL-to-SQL worker
        |     +-- Kusto HTTP client
        |     +-- Log Analytics HTTP client + Entra token provider
        |
        +-- Admin mutation workspace
              +-- dialog and workflow state
              +-- request/cancellation controller
              +-- connection-specific mutation adapter
                    +-- mock-schema mutation
                    +-- DuckDB schema SQL
                    +-- Kusto management commands
```

The primary application shell lives in `src/routes/(app)/+layout.svelte`. It creates the browser-scoped stores once, makes them available with Svelte context, hydrates persisted data after mount, and releases DuckDB workers when the shell is destroyed. Feature routes render workspace components rather than owning a separate copy of connection or query state.

## Source layout

| Area | Responsibility |
| --- | --- |
| `src/routes` | SvelteKit pages and route layouts. `(app)` contains the authenticated-style workspace routes; `auth/callback` completes the Entra popup flow; `labs` contains experimental pages. |
| `src/lib/components` | Page-level workspaces and reusable UI. `ui` contains shadcn-svelte-style primitives; `query`, `admin`, `explorer`, and `cluster` contain feature components. |
| `src/lib/cluster` | Connection definitions, capability policy, browser-persisted connection store, app session, and runtime dispatch. |
| `src/lib/query` | Query tabs, execution/cancellation lifecycle, saved and recent query stores, and result normalization. |
| `src/lib/kusto` | Kusto SDK client, schema and command helpers, ingestion planning, Monaco integration, and Kusto documentation support. |
| `src/lib/emulation` and `src/lib/duckdb` | The browser emulation implementation: DuckDB-WASM lifecycle, persistence, KQL-to-SQL execution, schema mutation, and ingestion. |
| `src/lib/log-analytics` and `src/lib/azure-auth` | Log Analytics API calls, Entra PKCE authentication, and persisted authentication-profile metadata. |
| `src/lib/admin` | Review/confirmation state, database-mutation workspace and request controller, and the connection-specific schema-mutation adapter. |
| `src/lib/workers` | Dedicated module workers for Kusto Monaco language services and KQL translation. |
| `scripts` | Generated-data, documentation-index, WASM, packaging, smoke-test, and release utilities. |

## State and persistence

There are two deliberately different kinds of state:

- `ClusterSession` is in-memory workspace state. It owns the confirmed active cluster, loaded schema, Explorer selection/expansion, query tabs, and per-tab result/error state. It is reset or reconciled when a connection changes.
- Browser stores persist user-owned settings and content. The connection, saved-query, recent-query, and Entra profile stores hydrate on the client so SSR never relies on browser storage. The active connection ID is stored independently as a preference.

Svelte 5 runes (`$state`, `$derived`, and `$effect`) back these stores and controllers. Store instances are passed through Svelte context rather than module-global mutable state, allowing SSR to create isolated instances and the app shell to own browser lifecycle work.

## Connections and capability dispatch

`createConnectionRuntime` in `src/lib/cluster/cluster-runtime.ts` is the central boundary between the UI and a connection implementation. It exposes a small, uniform interface:

- `loadSchema()`
- `startQuery(database, query)`
- `capabilities`

The capability policy in `connection-capabilities.ts` tells the UI which features are available. Runtime dispatch chooses the actual implementation:

| Connection kind | Schema source | Query execution | Schema mutation / ingestion |
| --- | --- | --- | --- |
| Mock | Browser-local mock schema | Unavailable | Browser-local schema mutations |
| Emulated | DuckDB catalog | KQL translated to DuckDB SQL in the browser | DuckDB SQL and browser file/data APIs |
| Remote | Kusto backend schema endpoint | Azure Kusto SDK request | Kusto management commands where supported by the local backend |
| Log Analytics | Log Analytics metadata API | Log Analytics query API | Unavailable |

Loading schemas is serialized through a transition queue. This prevents overlapping DuckDB-WASM sessions and ensures that a remote connection is validated before the current emulated runtime is released. Removing an emulated connection explicitly disposes its runtime; persistent OPFS storage is removed only as part of the confirmed connection-removal flow.

## Query workspace flow

`query-workspace.svelte` composes the query experience. It delegates focused responsibilities to controllers:

1. `ConnectionLifecycleController` loads a selected connection’s schema, suppresses stale schema responses, restores valid Explorer selection, and handles failed connection retries.
2. `QueryTabController` owns tab creation, selection, close confirmation, dirty-state detection, and two-tab comparisons.
3. `QueryExecutionController` records a recent query, starts a `ConnectionRuntime` execution, writes results or formatted diagnostics back to the owning tab, and supports cancellation. It owns a separate cancellable operation for each running tab, so queries may complete independently when the user switches tabs or starts another query.
4. `CancellableOperation` tracks one execution and protects its caller from late completions after replacement or teardown. A connection reset invalidates every tab operation, so advisory cancellation cannot write stale results after the user switches connections.

Every runtime produces the shared `QueryExecution`/`QueryResult` types in `src/lib/types/query-result.ts`. Result values are normalized before crossing the UI boundary: dates become ISO strings and `bigint` values become strings. This keeps rendering and browser persistence independent of SDK-specific objects.

Monaco is loaded lazily. `src/lib/kusto/runtime.ts` initializes Monaco once per browser window, routes Kusto language work to `src/lib/workers/kusto.worker.ts`, and configures enriched Kusto documentation. The KQL translator is also isolated in a worker so translation and WASM initialization do not block the main UI thread.

## Browser emulation

Emulation is local-first:

1. The KQL translator turns supported KQL into DuckDB SQL.
2. The DuckDB-WASM client executes SQL in a managed browser worker session.
3. `emulation/cluster.ts` maps DuckDB metadata to Kite’s Kusto-shaped schema and exposes cancellable query execution.
4. `emulation/schema-management.ts` translates reviewed table changes into transactional DuckDB DDL and comments.
5. `emulation/data-ingestion.ts` builds guarded CSV/Parquet ingestion statements and validates remote-file URLs.

Emulated storage may be memory-only or backed by browser OPFS, as documented in [Browser-emulated cluster](emulated-cluster.md). It is private to the browser origin and must not be treated as a backup.

## Administration and mutation safety

Admin components build a typed plan before performing a mutation. The plan contains the target, command, summary, and—where applicable—schema diff. `createReviewablePlan` governs draft → review → confirmation transitions, while `createAsyncDialogAction` supplies pending/error handling for simple confirmation dialogs.

Administration is split into three layers:

1. `database-management.svelte` renders database browsing, filtering, selection, schema exports, and action-menu wiring. It does not execute mutations.
2. `database-mutation-workspace.svelte.ts` owns all mutation dialog state, target selection, preflight, execution, schema refresh, post-operation verification, success/error state, and teardown. `database-mutation-workspace.svelte` is the focused view that binds the workspace to the database/table/column dialogs.
3. `database-mutation-controller.svelte.ts` owns mutation request identity, stale-request suppression, active cancellation, busy notifications, and adapter construction.

`createSchemaMutationAdapter` selects the mutation mechanism for the active connection. For remote table updates and drops, it first issues read-only preflight commands, parses the current table snapshot, and compares it with the snapshot loaded by the editor. A detected conflict blocks the mutation and triggers a schema refresh. Mock mutations use a revision-aware store update, and emulated mutations re-check the DuckDB snapshot before applying DDL.

Create-table flows refresh the schema after execution and confirm that the target table appears before reporting success. The adapter exposes separate stages for the base table command and optional column-documentation command so callers can distinguish partial completion when needed.

## Authentication and external APIs

Log Analytics connections use Microsoft Entra delegated authentication. `azure-auth` manages public-client PKCE popup sign-in and token acquisition; no client secret is accepted or stored. `log-analytics/client.ts` uses those tokens for metadata and query requests and preserves request IDs/raw error payloads when available so the UI can show actionable failures. The Kusto client is separate because local Kustainer connections use the Azure Kusto SDK request path.

## Build, generated assets, and tests

Vite builds the SvelteKit application. The production build can include generated Kusto documentation data and the KQL-to-SQL WASM artifact. Relevant scripts include:

- `npm run generate` regenerates Avro template types and the Kusto documentation index.
- `npm run build:kql-wasm` builds the translator artifact from the vendored translator project.
- `npm run check` runs Svelte type and template checks.
- `npm run test:unit:run` runs Vitest unit tests.
- `npm run test:e2e:run` runs Playwright against a production build.

Unit tests are colocated with their modules. Tests favor pure planners, schema parsers, runtime dispatch, storage policy, mutation-workspace state, per-tab query execution, and controller lifecycle behavior; end-to-end coverage in `tests/app.e2e.ts` exercises user-facing workflows.

## Adding a feature

When extending Kite, keep the layers separate:

1. Add or adjust connection policy in `connection-capabilities.ts` before enabling a UI action.
2. Put connection-specific behavior behind `ConnectionRuntime` or `SchemaMutationAdapter`, not directly in a presentation component.
3. Put multi-step UI workflows in focused controllers such as `QueryExecutionController` or `DatabaseMutationWorkspace`; keep page components responsible for composition and rendering.
4. Keep browser state in a context-backed store or focused controller; persist only user-owned state that should survive a reload.
5. Represent cross-connection results using the shared types and normalize values at an SDK/API boundary.
6. Make destructive actions reviewable and cancellable, and preflight remote schema changes that can race with other clients.
7. Add focused unit coverage and run `npm run check` before submitting changes.
