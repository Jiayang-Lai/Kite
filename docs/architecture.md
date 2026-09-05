# Architecture and implementation

Kite is a browser-first Kusto workspace. It is a prerendered SvelteKit application that lets a user work with one of four connection kinds: a browser-emulated Kusto-compatible cluster, a mock catalog, a local Kustainer-compatible Kusto endpoint, or Azure Log Analytics. The deployed application has no Kite-owned API or database: runtime state, preferences, saved content, authentication caches, and emulated data live in the browser, while remote connections call their configured Kusto or Log Analytics endpoints directly.

## System overview

```text
Cloudflare Pages or nginx static delivery
        |
        +-- prerendered SvelteKit routes and Svelte components
              |
              +-- context-owned browser state
              |     +-- ClusterSession (in memory)
              |     +-- connections, saved/recent queries, Azure profiles (local storage)
              |     +-- DuckDB databases (memory or OPFS)
              |
              +-- query and connection controllers
              |     +-- ConnectionRuntime driver registry
              |           +-- mock schema
              |           +-- DuckDB-WASM + KQL-to-SQL worker
              |           +-- Kusto SDK client
              |           +-- Log Analytics HTTP client + Entra token provider
              |
              +-- admin mutation workspace and controller
                    +-- connection-specific SchemaMutationPort
                          +-- mock-schema mutation
                          +-- DuckDB schema SQL
                          +-- Kusto management commands
```

The root route policy in `src/routes/+layout.ts` prerenders every current route. The primary application shell lives in `src/routes/(app)/+layout.svelte`; it creates browser-scoped stores once, makes them available with Svelte context, hydrates persisted data after mount, and releases DuckDB workers when the shell is destroyed. Feature routes render `QueryWorkspace` or `AdminWorkspace` with a view selector rather than owning separate copies of connection or query state. Those workspaces dynamically import their heavier view components.

## Source layout

| Area | Responsibility |
| --- | --- |
| `src/routes` | Thin SvelteKit page entry points and route layouts. `(app)` contains the Explorer and Admin workspaces; `auth/callback` provides the Entra popup return page. |
| `src/lib/components` | Page-level workspaces and reusable UI. `ui` contains shadcn-svelte-style primitives; `query`, `admin`, `explorer`, and `cluster` contain feature components. |
| `src/lib/cluster` | Connection definitions, capability policy, browser-persisted connection store, app session, and runtime dispatch. |
| `src/lib/query` | Query tabs, execution/cancellation lifecycle, saved and recent query stores, and result normalization. |
| `src/lib/kusto` | Kusto SDK client, schema and command helpers, ingestion planning, Monaco integration, and Kusto documentation support. |
| `src/lib/emulation` and `src/lib/duckdb` | The browser emulation implementation: DuckDB-WASM lifecycle, persistence, KQL-to-SQL execution, schema mutation, and ingestion. |
| `src/lib/log-analytics` and `src/lib/azure-auth` | Log Analytics API calls, Entra PKCE authentication, and persisted authentication-profile metadata. |
| `src/lib/admin` | Review/confirmation state, database-mutation workspace and request controller, and the connection-specific schema-mutation adapter. |
| `src/lib/workers` | Dedicated module workers for Kusto Monaco language services and KQL translation. |
| `src/lib/types`, `src/lib/data`, and `src/lib/generated` | Cross-backend result/schema contracts, built-in sample data, and deterministic generated TypeScript. |
| `scripts` | Generated-data, documentation-index, WASM, packaging, smoke-test, and release utilities. |
| `infra` and `.github/workflows` | Terraform roots for GitHub, Cloudflare, and Azure plus validation, preview, UAT, and release automation. |

## State and persistence

State is separated by lifetime and storage mechanism:

| State | Lifetime and storage | Owner |
| --- | --- | --- |
| Active schema, Explorer selection/expansion, query tabs, and per-tab results/errors | In memory for the application shell | `ClusterSession` |
| Custom connections and mutable mock schemas | `localStorage` | `ClusterConnectionStore` |
| Saved queries and the three most recent distinct queries | `localStorage` | `SavedQueryStore` and `RecentQueryStore` |
| Azure authentication profiles and account bindings | Profile metadata in `localStorage`; MSAL token cache in `sessionStorage` | `AzureAuthenticationProfileStore` and `AzureMsalClientManager` |
| Last confirmed connection | One-year same-site cookie | `active-cluster-preference.ts` |
| Pending cleanup after an emulated connection is removed | Small recovery journal in `localStorage` | `removed-cluster-cleanup.ts` |
| Emulated data | DuckDB memory or origin-private OPFS | DuckDB session keyed by connection ID |

Persisted stores validate records during hydration and ignore malformed entries rather than trusting browser storage. The connection store always restores built-in connections, deduplicates custom IDs, migrates legacy Log Analytics session/profile links, and preserves revision numbers for optimistic mock-schema updates.

Svelte 5 runes (`$state`, `$derived`, and `$effect`) back these stores and controllers. Store instances are passed through Svelte context rather than held as module-global mutable application state. This keeps construction request-safe and makes browser hydration and teardown explicit even though the current route set is prerendered.

## Connections and capability dispatch

`createConnectionRuntime` in `src/lib/cluster/cluster-runtime.ts` is the central boundary between the UI and a connection implementation. It exposes a small, uniform interface:

- `loadSchema()`
- `startQuery(database, query)`
- `dispose()`
- `capabilities`

The capability policy in `connection-capabilities.ts` tells the UI which features are available. Runtime dispatch chooses the actual implementation:

| Connection kind | Schema and query path | Administrative capabilities |
| --- | --- | --- |
| Mock | Browser-local mock schema; query execution unavailable | Create/drop/rename databases and mutate tables in the revisioned local schema; no ingestion |
| Emulated | DuckDB catalog; KQL translated to DuckDB SQL in the browser | Create/drop databases, mutate tables, and ingest inline/local/remote CSV or Parquet; database rename and dot commands are unavailable |
| Remote / local Kustainer | Backend schema endpoint and Azure Kusto SDK query request | Management commands and table mutations; database display-name changes; optional Kustainer ingestion when configured |
| Log Analytics | Metadata and query calls to the Logs APIs | Query-only; schema mutation, management commands, and ingestion are unavailable |

Drivers are registered by connection kind, so adding a kind requires a typed driver and a capability policy instead of conditionals throughout the UI. Schema loads and runtime disposal are serialized through one transition queue. This prevents overlapping DuckDB-WASM transitions and ensures that a remote connection is validated before inactive emulated sessions are released.

Connection switching commits only after schema loading succeeds. The lifecycle controller rejects stale responses, restores only selections that still exist, resets query operations when required, and retains the previous usable schema when a candidate connection fails. Log Analytics schema may be reused for five minutes; other loaded schemas remain in the shared session until an explicit refresh or mutation refresh.

Removing an emulated connection is a recoverable two-phase operation: Kite first journals the cleanup, persists catalog removal, then releases the runtime and deletes OPFS data. Interrupted or failed cleanup is retried after the stores hydrate, while a journal entry is discarded without deleting data if the connection still exists.

## Query workspace flow

`query-workspace.svelte` composes the query experience. It delegates focused responsibilities to controllers:

1. `ConnectionLifecycleController` loads a selected connection’s schema, suppresses stale schema responses, restores valid Explorer selection, and handles failed connection retries.
2. `QueryTabController` owns tab creation, selection, close confirmation, dirty-state detection, and two-tab comparisons.
3. `QueryExecutionController` records a recent query, starts a `ConnectionRuntime` execution, writes results or formatted diagnostics back to the owning tab, and supports cancellation. It owns a separate cancellable operation for each running tab, so queries may complete independently when the user switches tabs or starts another query.
4. `SavedQueryWorkspaceController` coordinates save/update dialogs, dirty saved-query state, loading saved queries into tabs, and navigation from non-editor views.
5. `CancellableOperation` tracks one execution and protects its caller from late completions after replacement or teardown. A connection reset invalidates every tab operation, so advisory cancellation cannot write stale results after the user switches connections.

Every runtime produces the shared `QueryExecution`/`QueryResult` types in `src/lib/types/query-result.ts`. Result values are normalized before crossing the UI boundary: dates become ISO strings and `bigint` values become strings. This keeps rendering and browser persistence independent of SDK-specific objects.

Monaco and the result/schema panes are loaded only for the editor view. `src/lib/kusto/runtime.ts` initializes Monaco once per browser window, routes Kusto language work to `src/lib/workers/kusto.worker.ts`, and configures enriched Kusto documentation. Schema objects passed to the language worker remain raw, structured-cloneable data rather than Svelte proxies. The KQL translator is isolated in a second worker so translation and .NET WASM initialization do not block the main UI thread.

## Browser emulation

Emulation is local-first:

1. The KQL translator turns supported KQL into DuckDB SQL.
2. The DuckDB-WASM client executes SQL in a managed browser worker session.
3. `emulation/cluster.ts` maps DuckDB metadata to Kite’s Kusto-shaped schema and exposes cancellable query execution.
4. `emulation/schema-management.ts` translates reviewed table changes into transactional DuckDB DDL and comments.
5. `emulation/data-ingestion.ts` builds guarded CSV/Parquet ingestion statements and validates remote-file URLs.

DuckDB is imported lazily and maintains at most one session promise per connection ID. Persistent sessions keep a manifest of Kite's logical databases, checkpoint after durable changes, and acquire an exclusive browser Web Lock so the same OPFS database cannot be opened by another tab. Worker, connection, database, and lock resources are released together on disposal.

The translator worker terminates after an idle period and is also disposed when leaving the query workspace or switching away from emulation. Emulated storage may be memory-only or backed by browser OPFS, as documented in [Browser-emulated cluster](emulated-cluster.md). It is private to the browser origin and must not be treated as a backup.

## Administration and mutation safety

Admin components build a typed plan before performing a mutation. The plan contains the target, command, summary, and—where applicable—schema diff. `createReviewablePlan` governs draft → review → confirmation transitions, while `createAsyncDialogAction` supplies pending/error handling for simple confirmation dialogs.

Administration is split into three layers:

1. `database-management.svelte` renders database browsing, filtering, selection, schema exports, and action-menu wiring. It does not execute mutations.
2. `database-mutation-workspace.svelte.ts` owns all mutation dialog state, target selection, preflight, execution, schema refresh, post-operation verification, success/error state, and teardown. `database-mutation-workspace.svelte` is the focused view that binds the workspace to the database/table/column dialogs.
3. `database-mutation-controller.svelte.ts` owns mutation request identity, stale-request suppression, active cancellation, busy notifications, and adapter construction.

`createSchemaMutationAdapter` selects the mutation mechanism for the active connection. For remote table updates and drops, it first issues read-only preflight commands, parses the current table snapshot, and compares it with the snapshot loaded by the editor. A detected conflict blocks the mutation and triggers a schema refresh. Mock mutations use a revision-aware store update, and emulated mutations re-check the DuckDB snapshot before applying DDL.

Create-table flows refresh the schema after execution and confirm that the target table appears before reporting success. The adapter exposes separate stages for the base table command and optional column-documentation command so callers can distinguish partial completion when needed.

## Authentication and external APIs

Log Analytics connections use Microsoft Entra delegated authentication. Authentication profiles separate reusable tenant/application configuration from workspace connection records. A connection links to a profile by ID; the compatibility facade resolves that profile and migrates legacy session IDs when hydrating old data.

`AzureMsalClientManager` manages public-client PKCE popup sign-in and token acquisition; no client secret is accepted or stored. It reuses one MSAL client per tenant/client pair, deduplicates token requests per account, and serializes interactive popups for a client pair. Account bindings are persisted with profile metadata, while MSAL stores its token cache in browser session storage. Signing out clears matching caches across linked profiles.

`log-analytics/client.ts` uses those tokens for two metadata requests and cancellable query requests. It preserves request IDs, statistics, visualization payloads, data-source details, and raw error payloads when available so the UI can show actionable failures. The Kusto client remains separate because local Kustainer connections use the Azure Kusto SDK request and management-command paths.

## Build and delivery

Vite selects one of two build targets through `KITE_BUILD_TARGET`:

| Target | Adapter and output | Browser runtime assets |
| --- | --- | --- |
| `cloudflare` (default) | SvelteKit Cloudflare adapter; direct-upload bundle under `.svelte-kit/cloudflare` | DuckDB workers are same-origin, while version-pinned DuckDB runtime WASM comes from jsDelivr because each runtime exceeds Cloudflare Pages' 25 MiB asset limit |
| `container` | SvelteKit static adapter; files under `build` served by unprivileged nginx | DuckDB workers and runtime WASM are bundled on the same origin |

Both targets serve the KQL-to-SQL .NET WASM framework and generated Kusto documentation from Kite's static assets. `wrangler.toml` describes the Cloudflare Pages direct-upload output and enables Node.js compatibility for the generated adapter worker. The container image is a multi-stage build: the .NET/Node stage generates the translator and static site, and the runtime stage contains only nginx and the built assets.

The Cloudflare, GitHub, and optional Azure resources are managed in separate Terraform roots. CI builds artifacts once per revision, deploys pull-request previews with trusted workflow code, deploys `main` to UAT, and promotes retained artifacts to release-candidate and production environments. See [CI/CD strategy](ci-cd.md) for the trust and promotion model.

## Generated assets and verification

Production builds include deterministic generated TypeScript, downloaded Kusto documentation, and the KQL-to-SQL WASM artifact. Relevant scripts include:

- `npm run generate` regenerates Avro template types and the Kusto documentation index.
- `npm run build:kql-wasm` builds the translator artifact from the vendored translator project.
- `npm run check` runs Svelte type and template checks.
- `npm run test:unit:run` runs Vitest unit tests.
- `npm run test:coverage` runs the same suite with V8 coverage enforcement.
- `npm run test:e2e:run` runs Playwright against a production build.

Vitest has separate browser/Chromium and Node projects. Tests are colocated with their modules and favor pure planners, schema parsers, runtime dispatch, storage policy, mutation-workspace state, per-tab query execution, and controller lifecycle behavior. Component tests render Svelte workspaces with browser context, while end-to-end coverage in `tests/app.e2e.ts` exercises user-facing workflows. Global statement, branch, function, and line coverage must each remain at or above 60%; non-component library code has higher thresholds in `vite.config.ts`.

## Adding a feature

When extending Kite, keep the layers separate:

1. Add or adjust connection policy in `connection-capabilities.ts` before enabling a UI action.
2. Put connection-specific behavior behind `ConnectionRuntime` or `SchemaMutationAdapter`, not directly in a presentation component.
3. Put multi-step UI workflows in focused controllers such as `QueryExecutionController` or `DatabaseMutationWorkspace`; keep page components responsible for composition and rendering.
4. Keep browser state in a context-backed store or focused controller; persist only user-owned state that should survive a reload.
5. Represent cross-connection results using the shared types and normalize values at an SDK/API boundary.
6. Make destructive actions reviewable and cancellable, and preflight remote schema changes that can race with other clients.
7. Treat local storage, API responses, worker messages, imported files, and generated/downloaded inputs as untrusted data and validate them at their boundary.
8. Add focused unit or browser-component coverage, keep every global coverage metric above 60%, and run `npm run check` before submitting changes.
