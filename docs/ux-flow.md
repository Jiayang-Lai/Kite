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
and database context. The mock cluster also supplies fixed Saved and Recent query fixtures; other
connections show only user-saved queries and their browser-local query history.

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

## Database and table management

`/admin/databases` browses the active cluster schema and provides structured database and table
updates. **New table** creates an empty table in the selected database with a validated name,
ordered initial columns, and optional description and folder. The dialog previews the equivalent
management operation and requires typing `CREATE TableName`. Immediately before execution, Kite
refreshes the database schema and blocks creation if that name is now occupied.

The execution backend depends on the active connection:

- Remote connections send generated Kusto management commands.
- Mock connections update their browser-local schema metadata.
- Emulated connections execute DuckDB DDL against their isolated WASM session.

The table editor can update a table description and append columns. The editor shows the generated
management operation and requires typing `RUN` before execution.

Each existing column also has an admin action menu. Rename opens a focused dialog, previews the
`.rename column` command, warns that stored functions, ingestion mappings, policies, dashboards, and
client queries aren't rewritten, and requires typing `RENAME`. Remove previews the `.drop column`
command, identifies the column type and current table row count, and requires typing the exact
`Table.Column` target. Removal is marked irreversible because adding a column with the same name
later can't restore its stored values. Kite conservatively disables removing the final table column.

Change type selects a different supported scalar type and previews the direct `.alter column`
command. Kusto doesn't convert existing values: every preexisting value in that column returns
`null` afterward, and changing back to the original type can't recover the data. The dialog marks
the operation as irreversible data loss and requires typing `CHANGE TYPE Table.Column`.

The **Reorder columns** action has one purpose: changing the order of every existing column. Names
and types are locked, and the editor can't add or omit a column. Kite renders an identity-aware
before/after order diff before review.

The review generates exactly one complete `.alter table` command. A domain guard requires every
verified column to appear exactly once, with its original name and type, and includes the verified
`docstring` and `folder` values so they aren't accidentally cleared. It warns operators to stop
order-dependent ingestion or use mapping objects before reordering. The user must type
`REORDER TableName` before the command can run.

Remote table updates run through the Kusto management endpoint and rely on Kusto to enforce Table
Admin permissions. Emulated updates use transactions where DuckDB supports them; mock updates use
an optimistic browser-local schema revision. The selected cluster cannot be changed while an update
is running. After a successful operation, Kite reloads the backend schema instead of applying an
optimistic UI-only update, keeping the Admin browser, Explorer, Monaco completion, and ingestion
table selection synchronized.

Opening any structured table or column editor captures a schema snapshot. Remote connections enrich
that snapshot with the Kusto table ID, CSL/JSON schema, metadata, and row count. Immediately before
an update, Kite repeats the relevant preflight and compares it with the original snapshot. A
recreated table or concurrent schema/metadata change blocks execution, refreshes the shared schema,
and requires the user to reopen the editor. On remote Kusto, the comparison narrows the concurrency
window but is not a server-side transaction.

## Management commands

`/admin/commands` executes database-scoped Kusto management commands against the active remote
cluster. The page uses the selected Admin database and sends commands only through the Kusto
management endpoint; command text must begin with `.`. The Mock cluster remains schema-only and
does not execute commands. Emulated clusters expose structured DuckDB-backed administration through
**Databases & tables**, but intentionally do not execute Kusto dot commands.

Read-only `.show` and `.explain` commands execute immediately. All other commands are treated as
potentially state-changing and require the user to review the target cluster/database, command
text, and type `RUN` before execution. Kite relies on the connected Kusto cluster to enforce the
caller’s permissions.

## Data ingestion

`/admin/ingestion` appends data to an existing table. The Mock cluster remains schema-only and shows
an unavailable state. Remote Kustainer and browser-emulated DuckDB connections share the target
selection, review, confirmation, and result-drawer experience, but use different execution
backends.

### Local Kustainer

The built-in `Local Kusto` connection declares `/kustodata/raw` as its container-visible staging
root and exposes four source modes:

- **Inline CSV** sends small, manually entered rows with `.ingest inline into table`. The text after
  `<|` is preserved exactly and follows the selected table's column order.
- **Inline file** preflights a browser-selected UTF-8 CSV file, optionally removes its header once,
  and splits it at complete CSV record boundaries. Commands run sequentially with a 512 KiB ceiling
  and stable per-target content hashes used as `ingest-by` tags. The default file limit is 10 MiB.
- **Mounted file** ingests an existing Parquet or CSV file beneath `/kustodata/raw`. Users enter a
  relative path; absolute paths and current/parent-directory segments are rejected before command
  construction.
- **Remote file** imports a CSV or Parquet file from a public HTTP(S) URL or a signed URL with
  temporary read access. CSV is selected by default and can optionally skip its first line. The
  command uses a Kusto obfuscated string literal to keep credentials out of service traces.

Commands execute synchronously through the Kusto management endpoint and return their extent result
directly. Inline-file progress reports confirmed chunks and rows, stops after the first failure, and
can retry from the uncertain chunk using its stable ingestion tag. Stopping the client request only
stops waiting; it does not promise to roll back an operation already accepted by Kusto. Previously
completed chunks remain ingested.

### Browser-emulated DuckDB

Emulated clusters expose three source modes:

- **Inline CSV** registers the entered text as a temporary DuckDB virtual file.
- **Local file** accepts CSV and Parquet. CSV is scanned to report its record and column shape.
  DuckDB reads the browser `File` through its FileReader protocol instead of copying the entire
  source into a JavaScript buffer.
- **Remote file** registers an HTTP(S) CSV or Parquet URL. Signed query parameters are masked in the
  review and result UI. The origin must support browser CORS and HTTP range requests.

Mounted-container files are hidden for emulated connections. Local files are limited to 512 MiB,
although the resulting in-memory table can be larger than the compressed or encoded source.

The emulated adapter rechecks the target, registers a random virtual filename, and runs a positional
`INSERT INTO … SELECT * FROM read_csv/read_parquet` inside a transaction on a dedicated DuckDB
connection. Failure or cancellation rolls back the active append. The adapter removes the virtual
file and closes the connection afterward. The result drawer reports inserted rows, target, source,
and DuckDB query elapsed time.

When adding a custom emulated connection, the user chooses **Ephemeral memory** or **Persistent
browser storage**. Persistent connections store a private manifest and logical-database schemas in
one OPFS DuckDB file, checkpoint committed schema and ingestion changes, and reopen that file after
a reload. An exclusive browser lock prevents two tabs from writing the same connection. Removing a
persistent connection also removes its local database and WAL files.

All ingestion modes show the ordered target schema and require a review of the cluster, database,
table, source, and append behavior followed by typing `RUN`. Neither backend discovers named
ingestion mappings, creates the target table, or provides durable ingestion job history.
