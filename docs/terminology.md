# Kite terminology and glossary

This glossary defines the words Kite uses in product copy, documentation, and code. It is intentionally specific: a connection is not always a Kusto cluster, and a Kusto-like database is not always a server-side Kusto database.

## Connection model

| Term | Meaning |
| --- | --- |
| **Connection** | A browser-local saved configuration that identifies a data backend, how to load its schema, and any settings needed to use it. In the interface, connections are often labelled as clusters because that is the familiar Kusto term. |
| **Cluster** | The backend selected in the connection switcher. Use **connection** when discussing Kite's saved configuration; use **cluster** when discussing Kusto's server concept or the user-facing selector. |
| **Connection ID** | A stable UUID for a saved connection. It is independent of its display name and URL, and scopes browser-local state such as saved queries, explorer expansion, and emulated storage. |
| **Connection URL** | The browser-visible endpoint or synthetic identifier for a connection. `mock://` and `emulated://` URLs identify local backends; they are not network endpoints. |
| **Built-in connection** | A connection supplied by Kite: Mock cluster, Emulated cluster, or Local Kusto. Built-ins cannot be removed or edited, although the Mock schema can be persisted. |
| **Custom connection** | A connection created and stored by the user in the current browser. It is not synchronized to other browsers, profiles, or origins. |
| **Selected connection** | The connection the user has chosen in the selector. Kite loads it before making it active. |
| **Active connection** | The connection whose schema and runtime are currently in use. If switching fails, the previous active connection remains available. |

## Connection kinds

`kind` is the backend category stored on every connection. It determines the available features; optional connection configuration supplies the details needed to perform them.

| Kind | Meaning | Query path | Schema source |
| --- | --- | --- | --- |
| **Remote** (`remote`) | A browser-accessible Kusto endpoint. Local Kustainer is Kite's built-in remote connection. | Kusto query API | Kusto backend metadata |
| **Log Analytics** (`log-analytics`) | One Azure Log Analytics workspace, authenticated with Microsoft Entra. It is a query-only analytics connection, not a general Kusto management connection. | Log Analytics query API | Log Analytics metadata API |
| **Mock** (`mock`) | A browser-local in-memory schema catalog used for exploration, demos, and editor language features. | None | Built-in or custom mock schema |
| **Emulated** (`emulated`) | A browser-local KQL-to-DuckDB environment. It is an emulation, not a Kusto server. | KQL translated to DuckDB SQL, then DuckDB-WASM | Live DuckDB catalog |

For the detailed behavior of the emulated kind, see [Browser-emulated cluster](emulated-cluster.md). For Log Analytics sign-in terminology, see [Azure authentication terminology](azure-authentication-terminology.md).

## Capabilities and execution

| Term | Meaning |
| --- | --- |
| **Connection capabilities** | The typed feature set resolved from a connection kind and its configuration. It describes schema/query routes and controls management commands, database operations, and ingestion. It does not replace the operational configuration itself. |
| **Connection runtime** | The backend-operation object created for one connection. It exposes `loadSchema()` and `startQuery()` and owns the dispatch to the selected backend implementation. |
| **Schema loader** | The runtime route used to obtain the database/table/function catalog: backend, Log Analytics, mock, or emulated. |
| **Query executor** | The route used for an editor query: Kusto, Log Analytics, emulated, or none. Mock connections have no query executor. |
| **Management command** | A Kusto dot command such as `.show tables`. Kite sends these only to remote Kusto connections; they are not available for Mock, Emulated, or Log Analytics connections. |
| **Read-only management command** | A management command that observes cluster state rather than changing it. Kite can refresh schema after a mutating command. |
| **Database capabilities** | The create, drop, and rename operations exposed for the active connection. A rename mode is either canonical-name, display-name, or unavailable. |
| **Canonical name** | The backend's stable identifier for a database or table. Mock and Emulated operations use canonical names. |
| **Display name** | The human-readable database label returned by a remote Kusto backend. Remote database rename changes this label rather than the canonical name. |

## Schemas and storage

| Term | Meaning |
| --- | --- |
| **Schema** | Kite's normalized catalog of databases, tables, columns, and functions used by the explorer and editor. It is not limited to a SQL `CREATE SCHEMA` namespace. |
| **Mock schema** | Browser-local schema metadata belonging to a Mock connection. A revision number supports optimistic concurrency when it is changed through Admin. |
| **Schema revision** | The incrementing `mockSchemaRevision` token used to prevent an outdated Mock editor from overwriting a newer local schema change. |
| **Emulated storage** | The persistence configuration for an Emulated connection. It is either ephemeral memory or persistent OPFS browser storage. |
| **Ephemeral / memory storage** | An Emulated connection whose DuckDB data exists only for the live browser session. It is cleared when the worker/session is released. |
| **OPFS storage** | Origin Private File System storage used by a persistent custom Emulated connection. It is private to one browser profile and origin, subject to quota/clearing, and is not a backup or sync service. |
| **DuckDB session** | The worker-backed DuckDB-WASM runtime owned by an active Emulated connection. Kite permits one live Emulated session at a time to control browser memory and storage access. |

## Ingestion and authentication

| Term | Meaning |
| --- | --- |
| **Ingestion** | Appending source data to an existing table. It is available for Emulated connections and for Remote connections that declare Kustainer ingestion configuration. |
| **Kustainer ingestion configuration** | Remote-connection settings identifying a mounted container directory and safe limits for browser-generated inline ingestion commands. Its presence enables the Kustainer ingestion feature. |
| **Mounted file** | A source file already visible inside Kustainer's configured container directory. This is distinct from a file selected in the browser. |
| **Inline file ingestion** | Browser-selected CSV data sent to Kustainer in bounded, generated management-command chunks. |
| **Authentication profile** | A reusable browser-local Microsoft Entra configuration used by a Log Analytics connection. It stores no tokens or client secrets. See [Azure authentication terminology](azure-authentication-terminology.md). |
| **Workspace ID** | The immutable GUID of a Log Analytics workspace. |
| **Workspace resource ID** | The Azure Resource Manager path for a Log Analytics workspace, used for resource-scoped metadata requests. |

## Preferred wording

- Say **connection kind** for `remote`, `log-analytics`, `mock`, and `emulated`; avoid “mode” when referring to the stored type.
- Say **capability** for whether Kite permits an operation; say **configuration** for the data required to perform it.
- Say **Emulated connection** or **Emulated cluster** rather than “local Kusto” when the backend is DuckDB-WASM.
- Reserve **remote Kusto connection** for the `remote` kind. A Log Analytics connection is remote in a networking sense but has its own kind and feature set.
- Say **browser-local** rather than “local” when data belongs to browser storage; say **Kustainer** or **server-side** for the local Kusto service.
