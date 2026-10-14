# Notes for coding agents

Kite is a local-first Kusto workspace: a prerendered SvelteKit app with no Kite-owned server or database. State lives in the browser, and remote connections call their Kusto or Log Analytics endpoints directly.

## Architecture

Before changing a part of Kite, read its section of the [architecture](docs/architecture.md) and check the source it names. [Adding a feature](docs/architecture.md#adding-a-feature) lists the layers a change has to keep. Setup, the translator build and every npm script are in the [development guide](docs/development.md).

## Code standards

Write and review changes against the [code standards](docs/code-standards.md). A change is ready only when it meets their acceptance criteria, and its pull request says which checks were run.

## Lessons

Before changing code, read [LESSONS.md](LESSONS.md): what earlier merged work got wrong and the rule that would have caught it. When a fix has to be made again, add or update a lesson in the change that fixes it.

## Words

Use the terms in the [terminology](docs/terminology.md). For example, say "connection kind", not "mode", and "browser-local" for data in browser storage.

## Workflows, Terraform and releases

Before changing `.github/workflows`, `infra/` or a release script, read the [CI/CD strategy](docs/ci-cd.md). Release tags can't be deleted, and secrets reach a run only through an environment that admits `main` or a release tag.

## Git

Use read-only Git unless the maintainer asks otherwise: don't create branches, stage, commit or push.

## Which code actually runs

The same feature runs different code depending on the connection kind and the build target. A bug report is usually about one of them.

| Connection kind | Schema, queries and admin run in |
| --- | --- |
| Emulated | `src/lib/emulation`, `src/lib/duckdb`, and the KQL-to-SQL worker in `src/lib/workers` with `vendor/kql-to-sql` |
| Local Kustainer (`remote`) | `src/lib/kusto` through the Azure Kusto SDK |
| Azure Log Analytics | `src/lib/log-analytics` and `src/lib/azure-auth`; query only |
| Mock | The built-in schema in `src/lib/cluster`; no query execution |

`createConnectionRuntime` in `src/lib/cluster/cluster-runtime.ts` picks the driver, and `connection-capabilities.ts` decides what the UI offers. Admin changes go through `createSchemaMutationAdapter` in `src/lib/admin`.

| Build target | Differs in |
| --- | --- |
| `cloudflare` (default) | DuckDB runtime WASM loads from jsDelivr; headers come from `_headers` |
| `container` | DuckDB runtime WASM is bundled; headers come from `docker/nginx.conf` and `docker/security-headers.conf` |

So for a bug report:

1. Find the connection kind and the build target: the hosted site or a self-hosted container.
2. Reproduce and fix it in that path.
3. Check whether the other kinds and the other target have the same bug, and fix them in the same change. A fix in one driver does nothing for the others.
