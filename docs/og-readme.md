## Kusto backend

The editor opens on its built-in **Mock cluster**, so every visitor can explore the schema and editor language features without a backend. **Emulated cluster** executes translated KQL through DuckDB-WASM in the browser. `Local Kusto` (`http://localhost:8080`) remains available for query execution against a local Kustainer.

The built-in **Mock cluster** is always available in the selector. It uses the local mock database catalog for schema browsing and editor language features; query execution is disabled for it.

### Browser-emulated DuckDB

The built-in `Emulated cluster` loads the .NET KQL-to-SQL bridge from `/kql-wasm/_framework/dotnet.js`, requests the DuckDB dialect, and executes the translated SQL in an isolated DuckDB-WASM worker. Its live catalog supplies databases, tables, and columns to Explorer and Monaco.

Structured Admin dialogs create and drop attached databases, create and alter tables, and update table comments. Custom emulated connections can use ephemeral memory or persistent browser OPFS; the built-in connection remains ephemeral. Kusto dot commands are unavailable because the emulated connection does not expose a Kusto management endpoint.

The ingestion page accepts inline CSV, browser-selected CSV/Parquet, and remote HTTP(S) CSV/Parquet. Appends run in DuckDB transactions and temporary registered files are removed after execution. Persistent custom connections checkpoint committed changes and reopen their OPFS file after reload; their logical databases are schemas within one cluster file. Ephemeral connections clear their data when the tab releases them. See [`docs/emulated-cluster.md`](emulated-cluster.md) for setup and limitations.

The endpoint must allow the app origin through CORS. On startup, Kite discovers databases and their schemas with read-only management commands. Queries entered in Monaco are sent only to the Kusto query endpoint, and can be run with the **Run** button or `Ctrl/Cmd+Enter`.

### Local Kustainer ingestion

The `Local Kusto` connection supports direct ingestion into existing tables. Pasted CSV and browser-selected CSV files are sent with `.ingest inline` management commands. Browser files are preflighted as UTF-8 CSV and split at complete record boundaries into commands no larger than 512 KiB. The default browser-file limit is 10 MiB. A header row can be removed once before chunking, and each chunk receives a stable `ingest-by` tag so an interrupted chunk can be retried without knowingly duplicating it.

Mounted-file ingestion expects Parquet or CSV files beneath `/kustodata/raw` inside the Kustainer container. Mount a host staging directory at that location, for example:

```yaml
services:
  kusto:
    image: mcr.microsoft.com/azuredataexplorer/kustainer-linux
    volumes:
      - ./kusto-raw:/kustodata/raw
    ports:
      - 127.0.0.1:8080:8080
    environment:
      - ACCEPT_EULA=Y
```

Mounted-file paths are relative to `/kustodata/raw`; Kite does not copy browser files into that directory. Inline-file contents remain in the browser and are sent sequentially through the Kusto management endpoint. Kustainer has no authentication or encrypted connection, so keep it bound to the local machine. Direct ingestion is intended for local development and does not provide managed queues, automatic retries, rollback, or durable job history.

## Research Note: Kusto Monaco Documentation

`@kusto/monaco-kusto` uses `@kusto/language-service-next` to produce KQL completion candidates. The next language service provides completion text and kinds, but it does not provide Markdown documentation for query operators such as `where` or `make-series`.

The Monaco adapter has a documentation path, but it consults the legacy `Kusto.Data.IntelliSense.CslDocumentation` registry. That registry is empty in the published browser package, and it runs in the Kusto worker rather than the Svelte window. Applications therefore need to enrich completion items themselves.

This project uses `kustoDefaults.setLanguageSettings({ onDidProvideCompletionItems })` to add completion details and Markdown documentation. `npm run download:kusto-docs` downloads Microsoft's rendered Markdown export (`?accept=text/markdown`) into `static/kusto-docs`, avoiding browser CORS and remote per-completion requests. The hook lazy-loads the matching same-origin Markdown file, removes front matter and Learn include directives when choosing the inline summary, and shows the full Markdown in Monaco's completion documentation pane. The `view online` link uses the normal public Learn URL.

The documentation lookup index is generated from Microsoft's Kusto query TOC instead of maintaining a hand-written operator list:

```sh
npm run update:kusto-docs-index
```

This updates the reviewed `data/kusto-documentation-index.json` snapshot and regenerates `src/lib/generated/kusto-documentation-index.ts`. Normal builds download Markdown from that committed snapshot without consulting the live TOC. The generated map includes query operator and function document paths. The current `monaco-kusto` completion callback does not preserve the original Kusto completion kind, so this TOC-derived map is used to resolve a completion label to its documentation path.

# Todos

- [x] Basic linting:
  - [x] Syntax validation
  - [x] Hover tooltip
  - [x] Auto completion
  - [x] Inline doc
  - [x] Formatting
- [ ] UI:
  - [ ] Components:
    - [x] Main editor
    - [x] Database explorer
    - [x] Table explorer
    - [x] Theme toggle
    - [x] Status bar for connection status
    - [x] Cluster switcher
    - [ ] Cluster connection editor (can view/edit cluster connections)
    - [x] Query history (using local storage)
    - [x] Saved queries (using local storage)
    - [x] Show more as a row if there are too many entries for saved queries, and show a list page when clicked
    - [x] Result drawer
    - [ ] Result drawer (use shadcn table via tanstack)
  - [ ] Pages:
    - [x] Kusto Query Page: explore clusters, databases, and tables; inspect schemas and functions; and run queries.
    - [ ] Kusto Admin Page:
      - [x] Allows user to run management commands
      - [x] Allows user to manage databases and tables etc (read and write)
        - [x] Create empty tables with an explicit initial schema and metadata
        - [x] Update table descriptions and append columns
        - [x] Block stale table updates with execution-time schema preflights
        - [x] Rename columns with dependency warnings and explicit confirmation
        - [x] Remove columns with irreversible-data-loss confirmation
        - [x] Reorder every existing column with an explicit before/after diff
        - [x] Directly change column types with irreversible-data-loss confirmation
        - [ ] Better UI
      - [x] Allows Kustainer ingestion from pasted/chunked CSV and mounted or remote files
      - [x] Allows emulated DuckDB ingestion from inline, browser-selected, or remote CSV/Parquet
      - [x] Allows user to view cluster, database and table

Myself:

- [ ] Learn the different terms for theming
