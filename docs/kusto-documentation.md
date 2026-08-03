# Kusto documentation pipeline

Kite bundles selected Microsoft Learn Kusto query documentation so Monaco completion and hover help can load Markdown from the application itself. Production builds do not query the live Kusto table of contents at runtime.

## Data flow

The pipeline separates the reviewed documentation index from the downloaded build assets:

```text
Microsoft Kusto query TOC
          │ maintainer refresh
          ▼
data/kusto-documentation-index.json
          ├──────────────► src/lib/generated/kusto-documentation-index.ts
          │                 completion label → document path
          │
          └──────────────► static/kusto-docs/<path>.md
                            downloaded build assets
                                      │
                                      ▼
                         Monaco completion and hover help
```

`data/kusto-documentation-index.json` is the committed, reviewed input. It maps completion labels to Microsoft documentation paths. Multiple labels can point to the same document, so the downloader deduplicates paths before making requests.

`src/lib/generated/kusto-documentation-index.ts` is the committed TypeScript representation used by the application. `static/kusto-docs` contains generated Markdown assets, is ignored by Git, and must exist before a production build finishes.

## Routine downloads

Run the downloader with:

```bash
npm run download:kusto-docs
```

The script reads only the committed index; it does not consult the live Microsoft TOC. For every unique path, it:

1. Skips the document when `static/kusto-docs/<path>.md` already exists.
2. Requests the Microsoft Learn page with `accept=text/markdown`.
3. Creates any required directory and writes the returned Markdown.

Use `--force` to download every indexed document again:

```bash
npm run download:kusto-docs -- --force
```

To refresh one document, remove only its generated file and run the normal command. Do not commit files under `static/kusto-docs`.

## Throttling and recovery

The download queue permits five requests in flight but uses one shared scheduler to pace new request starts. A worker cannot bypass that scheduler when another worker has encountered a rate limit.

The fetcher retries network errors and HTTP `408`, `429`, `500`, `502`, `503`, and `504`. Its default behavior is:

- Start requests at least 50 milliseconds apart.
- Attempt each request once plus as many as five retries.
- Honor `Retry-After` when present, while enforcing an exponential minimum delay.
- Back off for 15, 30, 60, and then at most 120 seconds, with up to one second of random jitter.
- Apply every transient-response cooldown to the entire queue, not only the request that received it.

Responses already in flight can still complete after a cooldown begins, but no new request or retry starts before the shared cooldown expires.

If a document still fails after its retry budget, the main queue records it as deferred and continues. After that queue drains, deferred documents receive a sequential recovery pass without competition from later documents. The command fails only when documents remain unavailable after recovery, and its final error lists every failed path. Successfully written files remain available for the next local run.

The retry scheduler is implemented in `scripts/lib/kusto-documentation.mjs`. Queueing, file writes, recovery, and reporting are implemented in `scripts/download-kusto-documentation.mjs`.

## Refreshing the reviewed index

Refreshing the index is a separate maintainer action:

```bash
npm run update:kusto-docs-index
```

This command downloads Microsoft's current Kusto query TOC, extracts operator and function paths, updates `data/kusto-documentation-index.json`, and regenerates `src/lib/generated/kusto-documentation-index.ts`.

Review the index diff before committing it. Upstream additions, removals, renames, and label collisions can change which completion items resolve to documentation. After accepting an index update, run the documentation downloader to verify that every referenced page remains available.

## Builds and CI caching

`npm run build` regenerates committed source representations and downloads any missing Markdown during its prebuild phase. A clean source or container build therefore needs access to Microsoft Learn unless `static/kusto-docs` has already been populated.

CI prepares the Kusto documentation once and shares it with jobs that build the Cloudflare and container targets. Its cache key includes:

- the runner operating system;
- the current UTC ISO week;
- the documentation index;
- the downloader and its shared library.

Consequently, CI reuses the same assets during a week but performs a fresh download after the week or relevant inputs change.

## Troubleshooting

### HTTP 429 after recovery

The service remained throttled through both retry phases. Keep the successful files and rerun the command later. Avoid starting several forced downloads from the same network address at once.

### HTTP 404 or another permanent response

The committed index may refer to a page Microsoft moved or removed. Run the index refresh, review its diff, and confirm the affected page in the upstream TOC. Permanent responses receive the final sequential recovery attempt but are not repeatedly backed off like transient failures.

### A build tries to download every document

Confirm that `static/kusto-docs` was restored or copied into the build context. The directory is generated and Git-ignored, so a clean checkout is expected to download all unique paths when no CI cache is available.

### Testing downloader changes

The focused tests use mocked responses and a virtual clock, so they do not contact Microsoft Learn:

```bash
npx vitest --run scripts/lib/kusto-documentation.test.mjs
```

Also run formatting, static checks, and the server unit suite before committing downloader changes:

```bash
npm run lint:ci
npm run check
npx vitest --run --project server
```
