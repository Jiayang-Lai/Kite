# Workspace UX flow

## Goal

Explorer and Admin are sibling workspaces that share the selected cluster, application shell, and
settings. The Explorer stays available in both workspaces, but selecting an Explorer item from an
Admin route opens that item in Explorer.

## Routes

```text
/                 → Application landing page
/explorer         → Explorer landing page
/explorer/query   → Query workspace
/explorer/query/saved → Saved-query list
/admin            → Admin landing page
/admin/commands   → Management commands
/admin/databases  → Database and table management
/admin/ingestion  → Data ingestion
```

## Transitions

```mermaid
flowchart TD
    Root["/<br/>Application landing"] --> ExplorerHome["/explorer<br/>Explorer landing"]
    ExplorerHome --> Query["/explorer/query<br/>Query workspace"]
    Query -->|Saved queries: More| SavedQueries["/explorer/query/saved<br/>Saved-query list"]
    SavedQueries -->|Open in Query| Query
    ExplorerHome -->|Admin sidebar entry| AdminHome["/admin<br/>Admin landing"]
    AdminHome -->|Admin card or sidebar| AdminCommands["/admin/commands<br/>Admin: Commands"]
    AdminHome -->|Admin card or sidebar| AdminDatabases["/admin/databases<br/>Admin: Databases & tables"]
    AdminHome -->|Admin card or sidebar| AdminIngestion["/admin/ingestion<br/>Admin: Data ingestion"]
    AdminCommands -->|Admin sidebar| AdminHome
    AdminDatabases -->|Admin sidebar| AdminHome
    AdminIngestion -->|Admin sidebar| AdminHome
    AdminHome -->|Explorer item or Kite breadcrumb| Query
    AdminCommands -->|Explorer item or Kite breadcrumb| Query
    AdminDatabases -->|Explorer item or Kite breadcrumb| Query
    AdminIngestion -->|Explorer item or Kite breadcrumb| Query

    Shared["Shared app shell<br/>selected cluster · settings · sidebar state"]
    Shared --- ExplorerHome
    Shared --- Query
    Shared --- SavedQueries
    Shared --- AdminHome
    Shared --- AdminCommands
    Shared --- AdminDatabases
    Shared --- AdminIngestion
```

## Sidebar hierarchy

```text
CONNECTION
  Local Kusto                     ⌄

EXPLORER
  Search databases and objects
  Databases
  Saved queries (first 5, then More → /explorer/query/saved)
  Recent queries

ADMIN
  Commands
  Databases & tables
  Data ingestion
```

The Explorer and flattened Admin group are present on Explorer and Admin routes. The Admin landing
page is `/admin`; the group provides direct access to the feature routes, including Commands at
`/admin/commands`. It is visually
distinct from the sidebar cluster selector, which sets global connection context. On Admin routes,
choosing a database, table, function, saved query, or recent query opens Explorer with that context;
saved and recent queries also restore their KQL in the editor.

Saved queries are stored in browser local storage and scoped to the selected connection's stable ID.
The Query toolbar provides a Save action that asks for a name, then persists the current editor text
and database context. The mock cluster also supplies fixed Saved and Recent query fixtures; remote
connections show only user-saved queries until query history is available.

Recent queries are also stored in browser local storage. Every submitted runnable query is added to
the history, duplicate executions move to the top, and the collection retains only its latest three
entries.

Breadcrumbs provide a second route back to Query:

```text
Kite / Explorer
Kite / Explorer / Query
Kite / Explorer / Query / Saved queries
Kite / Admin
Kite / Admin / Management commands
Kite / Admin / Databases & tables
Kite / Admin / Data ingestion
```

The `Kite` breadcrumb links to `/`. The selected cluster, loaded schema, Explorer selection,
and pending query remain available across route transitions. Opening an Admin route directly
also loads the active cluster schema so Explorer content is available.

## Management commands

`/admin/commands` executes database-scoped Kusto management commands against the active remote
cluster. The page uses the selected Admin database and sends commands only through the Kusto
management endpoint; command text must begin with `.`. The Mock cluster remains schema-only and
does not execute commands.

Read-only `.show` and `.explain` commands execute immediately. All other commands are treated as
potentially state-changing and require the user to review the target cluster/database, command
text, and type `RUN` before execution. Kite relies on the connected Kusto cluster to enforce the
caller’s permissions.

## Data ingestion

`/admin/ingestion` performs direct ingestion into an existing table for connections that explicitly
declare Kustainer ingestion support. The built-in `Local Kusto` connection uses `/kustodata/raw` as
its container-visible staging root. The Mock cluster remains schema-only and shows an unavailable
state.

The page has three source modes:

- **Inline CSV** sends small, manually entered rows with `.ingest inline into table`. The text after
  `<|` is preserved exactly and follows the selected table's column order.
- **Inline file** preflights a browser-selected UTF-8 CSV file, optionally removes its header once,
  and splits it at complete CSV record boundaries. Commands run sequentially with a 512 KiB ceiling
  and stable per-target content hashes used as `ingest-by` tags. The default file limit is 10 MiB.
- **Mounted file** ingests an existing Parquet or CSV file beneath `/kustodata/raw`. Users enter a
  relative path; absolute paths and current/parent-directory segments are rejected before command
  construction.

Both modes show the ordered target schema and require a review of the cluster, database, table,
source, and append behavior followed by typing `RUN`. Commands execute synchronously through the
management endpoint and return their extent result directly. Inline-file progress reports confirmed
chunks and rows, stops after the first failure, and can retry from the uncertain chunk using its
stable ingestion tag. Stopping the client request only stops waiting; it does not promise to roll
back an operation already accepted by Kusto. Previously completed chunks remain ingested.

This workflow does not copy browser files into Kustainer's mounted filesystem, discover named
ingestion mappings, create or modify tables, retry failed requests automatically, or model
queued/streaming ingestion. Those capabilities are outside the local Kustainer flow.
