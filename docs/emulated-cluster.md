# Browser-emulated cluster

## Overview

The **Emulated cluster** runs KQL without a Kusto service. Kite translates KQL to DuckDB SQL with
the [`kql-to-sql`](https://github.com/Jiayang-Lai/kql-to-sql) .NET WebAssembly bridge, then executes
that SQL in DuckDB-WASM. Translation, query execution, schema administration, and ingestion happen
inside the browser tab.

The emulated connection is designed for demonstrations, local analysis, prototyping, and testing.
It is not a Kusto-compatible server and does not implement Kusto management endpoints.

## Runtime flow

```text
KQL editor
    ↓
/kql-wasm/_framework/dotnet.js
    ↓
kql-to-sql DuckDB dialect
    ↓
isolated DuckDB-WASM worker
    ↓
shared Kite result drawer
```

Every emulated connection is identified by its cluster ID and owns a separate DuckDB session.
Built-in and custom emulated connections therefore do not share databases or rows. The built-in
connection is ephemeral. A custom connection can be created with either ephemeral memory or
persistent browser storage.

## Translator assets

Kite expects the translator at:

```text
static/kql-wasm/_framework/dotnet.js
```

The directory is ignored by Git and is not produced by Kite's npm build. Build it from the
translator repository:

```bash
git clone --recurse-submodules https://github.com/Jiayang-Lai/kql-to-sql.git
cd kql-to-sql
dotnet workload install wasm-tools
dotnet publish src/KqlWasmBridge/KqlWasmBridge.csproj -c Release -o build-wasm

mkdir -p ../Kite/static/kql-wasm
cp -R build-wasm/wwwroot/_framework ../Kite/static/kql-wasm/
```

The bridge currently targets .NET 10. A production pipeline must build or download a pinned
translator artifact before running the Kite production build.

## Capabilities

| Capability                          | Emulated cluster behavior                            |
| ----------------------------------- | ---------------------------------------------------- |
| KQL queries                         | Translated to DuckDB SQL and executed in the browser |
| Database and table discovery        | Read from the live DuckDB catalog                    |
| Create/drop database                | Supported as memory databases or persistent schemas  |
| Rename database                     | Not supported                                        |
| Create/drop table                   | Supported                                            |
| Add, rename, remove, reorder column | Supported through structured Admin dialogs           |
| Change column type                  | Supported through DuckDB DDL                         |
| Table description                   | Stored as a DuckDB table comment                     |
| Kusto management commands           | Not supported                                        |
| Stored Kusto functions/policies     | Not supported                                        |
| Data ingestion                      | Inline, local file, and remote file append           |
| Persistence across full reloads     | Opt-in for custom connections through browser OPFS   |

The logical default `memory` database cannot be removed. Ephemeral connections create additional
databases with `ATTACH ':memory:'`. Persistent connections isolate logical databases as schemas
inside one OPFS DuckDB file and keep their names in a private manifest.

## Persistent browser storage

Choose **Persistent browser storage** when adding a custom emulated cluster. Kite opens the
cluster's DuckDB catalog with a stable OPFS filename derived from its connection ID. On startup it:

1. Acquires an exclusive browser lock for the connection.
2. Opens the cluster file in read/write mode.
3. Reads the logical-database manifest.
4. Restores each logical database as an isolated DuckDB schema.
5. Selects the logical `memory` schema by default.

Committed ingestion and structured schema changes are checkpointed. Closing a session performs a
final checkpoint and releases its OPFS handles. Kite restarts the DuckDB worker at mutation
checkpoints so DuckDB-WASM closes and flushes its synchronous OPFS handles. A second tab cannot open
the same persistent connection for writing while the first tab owns it.

OPFS belongs to the web origin and browser profile. For example, localhost and a production
deployment have separate data. Clearing site data removes the files, and storage remains subject to
browser quota and eviction policy. Kite requests persistent storage when possible, but OPFS is not
a backup or a synchronization service.

Storage mode is fixed when the custom connection is created. Existing ephemeral connections remain
ephemeral; create a persistent connection before loading durable data. Removing a persistent
connection permanently deletes its cluster and WAL files.

## Data ingestion

Open **Admin → Data ingestion**, select a database and existing table, then choose a source:

- **Inline CSV** accepts manually entered rows in the target table's column order.
- **Local file** accepts CSV and Parquet. CSV is scanned before review to report its row and column
  shape. DuckDB reads the selected browser `File` through the FileReader protocol rather than
  copying the complete source into a JavaScript buffer.
- **Remote file** accepts an HTTP(S) CSV or Parquet URL. Signed query parameters are masked in the
  review and result UI. The source server must allow browser CORS and HTTP range requests.
- **Mounted file** is not available because browser DuckDB cannot access a Kustainer container
  filesystem.

The local-file limit is 512 MiB. This limits the source file, not the expanded in-memory size of the
resulting DuckDB table.

An ingestion:

1. Rechecks that the target database and table exist.
2. Registers the source under a random virtual filename.
3. Runs a positional `INSERT INTO … SELECT * FROM read_csv/read_parquet` inside a transaction.
4. Commits on success or rolls back on failure/cancellation.
5. Removes the registered virtual file and closes the dedicated ingestion connection.

DuckDB converts source values to the existing target column types. A column-count mismatch or an
invalid conversion fails the transaction without committing partial rows. Repeating a completed
ingestion appends the data again; there is no durable ingest-by history.

## Memory and lifecycle

Every active database uses DuckDB-WASM memory for execution and caching:

- Client-side navigation between Explorer and Admin preserves the selected connection and either
  storage mode.
- Switching clusters or leaving the application workspace terminates the previous DuckDB worker.
- Ephemeral data is cleared by a cluster switch, workspace exit, hard reload, tab close, browser
  crash, or worker termination.
- Persistent OPFS data is reopened after a reload or a new tab session.
- Local file handles avoid a full JavaScript-side copy, but imported table data still consumes WASM
  memory.
- Inline CSV temporarily exists both as editor text and as a registered DuckDB text file.
- At most one emulated connection owns a live DuckDB worker.

Use a remote Kustainer connection when shared/server-managed durability, Kusto management commands,
ingestion policies, or production-scale workloads are required.

## Limitations

- Translation is limited to the operators and functions supported by `kql-to-sql`.
- Kusto and DuckDB can differ in types, null behavior, dynamic values, functions, and query
  semantics.
- Normal query cancellation is logical: a late result is ignored, but DuckDB-WASM may continue
  computing until the materialized query finishes.
- Ingestion uses a dedicated connection and requests DuckDB cancellation; successfully committed
  ingestion cannot be undone from the ingestion page.
- Remote ingestion depends on browser networking policy and the source server's CORS/range support.
- Emulated data is not synchronized across tabs. Persistent connections enforce a single active
  writer with the browser Web Locks API.

## Troubleshooting

- **Translator failed to start:** confirm that `/kql-wasm/_framework/dotnet.js` returns JavaScript
  rather than a 404 page. Open `/labs/kql-to-sql` to test translation and DuckDB independently of
  the cluster workspace.
- **DuckDB worker fails during development:** clear Vite's dependency cache and restart the dev
  server. Kite creates DuckDB workers as JavaScript modules; do not replace the worker construction
  with a classic worker.
- **A database disappeared:** confirm that the custom connection was created with persistent browser
  storage and that the app is running on the same origin. Ephemeral connections intentionally start
  empty after a reload.
- **Cluster already open:** close the other tab using the persistent connection, then retry. Kite
  allows only one active DuckDB-WASM writer for an OPFS cluster.
- **Remote ingestion fails:** verify CORS headers and byte-range support on the source. Test with an
  unsigned public URL before diagnosing signed credentials.
- **Memory remains high:** switch to a non-emulated cluster or leave the application workspace to
  terminate DuckDB. The selected emulated cluster and large imported tables can consume
  substantially more memory than their source files.

## Developer map

- `src/lib/kql/wasm-translator.ts` loads the .NET bridge and requests the DuckDB dialect.
- `src/lib/duckdb/query-client.ts` owns DuckDB bundles, workers, sessions, registered files, and
  OPFS catalogs, checkpoints, and result adaptation.
- `src/lib/emulated/storage.ts` owns persisted storage descriptors and runtime session registration.
- `src/lib/emulated/emulated-cluster.ts` adapts KQL execution and the DuckDB catalog.
- `src/lib/emulated/schema-management.ts` implements structured database and table DDL.
- `src/lib/emulated/data-ingestion.ts` validates sources and performs atomic append operations.
- `src/lib/components/admin/data-ingestion-workspace.svelte` provides the shared Kustainer/DuckDB
  ingestion UI.

Run the relevant validation with:

```bash
npm run check
npm run test:unit:run
npm run build
npm run test:e2e:run
```
