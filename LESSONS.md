# Lessons from merged work

Kite's code is written and reviewed by its maintainer and coding agents. When a fix had to be made again, or something merged that shouldn't have, what we learned is kept here. Read this before changing code.

Each lesson is a rule, then why, then the evidence: the commits and pull requests that went wrong and the ones that fixed them. "Seen" counts the separate days the failure was found. A lesson seen on 3 or more days moves into [docs/code-standards.md](docs/code-standards.md) and is listed under [Moved to the code standards](#moved-to-the-code-standards).

Add or update a lesson in the change that fixes the failure. If the failure matches an existing lesson, add the new evidence to it and raise its count rather than writing a second one. When a change follows a lesson well, add a "Done right" bullet so the next one has an example.

The first lessons were written on 2026-10-14, from the fixes released in 0.1.0 (#86) and the review of the release-tag workflow (67dbfa4).

## Building commands

**Build Kusto text with the helpers in `src/lib/kusto/command-format.ts`, which escape with backslashes.**

- Kusto escapes a quote as `\'` and a backslash as `\\`. Doubling a quote, as SQL does, doesn't produce a quote.
- 5c577b8 (#1) escaped entity names and string literals with `''`, in three places. Table, column and database names, docstrings and folders holding an apostrophe or a backslash made invalid commands until 2fad2c4 (#86), released in 0.1.0.
- Test a new command with a name that holds `'` and ends in `\`.
- Seen 1× (2026-10-14).

## Browser and delivery

**Check a browser dependency against the Content Security Policy before adding it.**

- 0461d20 (#25) added `avsc` for Avro table templates. Its validators are generated code that needs `'unsafe-eval'`, which would have stopped the policy from ever being enforced. 2fad2c4 (#86) replaced it with `src/lib/kusto/avro-schema.ts`.
- Look for `eval`, `new Function`, inline scripts and new origins. The end-to-end fixture in `tests/fixtures/content-security-policy.ts` fails on a violation. Don't add a `csp-known-violation` annotation without the maintainer's agreement.
- Seen 1× (2026-10-14).

**Every nginx `location` includes the security headers.**

- nginx drops all inherited `add_header` directives in a `location` that declares one of its own. Until 2fad2c4 (#86) the container sent `X-Frame-Options`, `Referrer-Policy` and `X-Content-Type-Options` only from its health check.
- Include `docker/security-headers.conf` in each `location`, and keep the Cloudflare `_headers` file in step with it.
- #86 fixed it without a test. The Pull Request workflow's "Check security headers on every nginx location" step now requests a path served by each `location` and fails on a missing header.
- Seen 1× (2026-10-14).

**Test SQL by running it against real DuckDB and checking the result, not by comparing its text.**

- d399899 (#31, 2026-08-02) reordered an emulated table's columns by rebuilding it with `CREATE TABLE ... AS SELECT`, which copies no comments. Every column's documentation was deleted on reorder for ten weeks. The unit tests mocked DuckDB and compared the SQL text, so they passed, and the mock cluster's reorder kept the comments.
- `src/lib/emulation/*.svelte.test.ts` now run schema changes and ingestion against DuckDB-WASM in Chromium, in memory and persistent storage, and check the schema and rows DuckDB reports. Their reorder test caught the bug on its first run. The reorder action was then removed as rarely needed, but the other table changes and ingestion stay covered.
- Mock DuckDB only for cases real DuckDB can't produce, such as a failing rollback.
- Seen 1× (2026-10-14).

**Reproduce a layout bug in the real app before trusting a component test that passes.**

- The **Databases & tables** list is virtualized, and every expand or fold called `virtualizer.measure()`, which discards every card's measured height. Only cards that then resized were measured again, so an expanded table fell back to the 62 px estimate and the next card was drawn over its columns.
- A component test of the same steps passed on the broken code. Its list was too short to show the cards, so Playwright's `click()` scrolled each one into view, and scrolling re-measured them. A script against the production build reproduced it on the first try.
- Re-measure on-screen cards after a toggle rather than resetting the cache, and keep the regression test in `tests/app.e2e.ts`, which runs the real layout.
- Seen 1× (2026-10-14).

## Workflows and releases

**Do everything that can fail before anything that can't be undone.**

- Release tags can't be deleted. Up to 2fad2c4, Create release tag created the tag first, and the Release workflow checked it afterwards. A stable tag for a release candidate still deploying, or one whose artifact had expired, used up its version.
- 67dbfa4 runs Release's checks, from `scripts/lib/release-readiness.mjs`, before the tag is created.
- Seen 1× (2026-10-14).

**Identify a workflow run, and the code it runs, by path and commit, not by name or branch head.**

- A workflow's `name` is just text in its YAML. Release first accepted any successful run named "Main UAT" or "Release" as the source of an artifact. 1b2bbf5 (#6) matched `run.path` and `run.head_branch` instead.
- A tag-triggered workflow runs the YAML from the tagged commit, and `actions/checkout` decides which scripts are on disk. While 67dbfa4 was being written, Release's `verify` job first loaded its checks from `main` while its YAML came from the tag, so a later change on `main` would have broken older tags. It was caught in review, and 67dbfa4 checks out the tag.
- Seen 2× (2026-07-26, 2026-10-14).

**Select the tests a CI step runs by tag, not by title.**

- The container job ran `playwright test --grep "<title>|<title>"`. c140cbf (#55, 2026-08-30) removed one of those tests with the `/labs/kql-to-sql` page. The grep still matched the other test, so the job stayed green for six weeks while nothing checked that the container serves DuckDB from Kite's origin, and `KITE_E2E_REQUIRE_LOCAL_DUCKDB_ASSETS` was read by nothing.
- Tag such tests (`{ tag: '@container' }`) and select with `--grep @container`. Playwright fails when nothing matches, so a lost tag is caught.
- When removing or renaming a test, search the workflows for its title and for the environment variables it reads.
- Seen 1× (2026-10-14).

## Moved to the code standards

These were seen on three or more days. The rule and its evidence are in [docs/code-standards.md](docs/code-standards.md); a review still checks each one.

- **Every changed line is covered, including each of its branches** (2026-09-04, 09-05, 09-11, 10-13, 10-14). Codecov marked the patch report ❌ on #68, #72, #73, #86 and #87 while every status check passed, because 60% global coverage hides gaps in new code. On #87 the 14 lines were a partial-failure path tested only in the adapter, an unreachable `if (!plan)` copied into two dialogs, and a toggle covered only by an end-to-end test. `npm run coverage:patch` now lists such lines before pushing.
