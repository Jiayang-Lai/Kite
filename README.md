# Kite

<p align="center">
  <img src="docs/.pics/kite.svg" alt="Kite application icon" width="128" height="128">
</p>

[![Latest release](https://img.shields.io/github/v/release/Jiayang-Lai/Kite?display_name=tag&sort=semver)](https://github.com/Jiayang-Lai/Kite/releases/latest) [![Container image](https://img.shields.io/badge/ghcr.io-jiayang--lai%2Fkite-blue?logo=github)](https://github.com/Jiayang-Lai/Kite/pkgs/container/kite) [![Main UAT](https://github.com/Jiayang-Lai/Kite/actions/workflows/main-uat.yml/badge.svg?branch=main&event=push)](https://github.com/Jiayang-Lai/Kite/actions/workflows/main-uat.yml) [![Website](https://img.shields.io/website?url=https%3A%2F%2Fkite.humblehamster.com&label=website)](https://kite.humblehamster.com/) [![License: MIT](https://img.shields.io/github/license/Jiayang-Lai/Kite)](LICENSE) [![Node.js >=22](https://img.shields.io/badge/Node.js-%3E%3D22-339933?logo=nodedotjs&logoColor=white)](package.json)

A local-first [Kusto](https://learn.microsoft.com/kusto/) workspace for exploring data, writing KQL, and administering local clusters—including a browser-based Kusto emulation mode with no server or cloud account required.

[Try Kite online](https://kite.humblehamster.com/) · [Follow the quick start](docs/avro-emulated-quick-start.md) · [Self-host Kite](docs/self-hosting.md)

<!-- prettier-ignore -->
> [!WARNING]
> Kite is currently in alpha and evolving rapidly. Keep a separate backup of Kustainer data and saved queries, especially before updating or reconfiguring the application. Do not use Kite or its browser storage as the only copy of important data.

## What Kite does

Kite brings KQL authoring, schema exploration, and cluster administration into one interface. You can:

- Browse clusters, databases, tables, functions, and schemas.
- Write and format KQL with completion, validation, hover help, and inline documentation.
- Translate KQL to DuckDB SQL and execute it entirely in the browser.
- Run queries and management commands against a local Kustainer instance.
- Create browser-local databases and tables and ingest inline, CSV, or Parquet data.
- Save queries and revisit recent work in browser storage.

Kite is built with SvelteKit, TypeScript, Tailwind CSS, Monaco Editor, DuckDB-WASM, and the Azure Kusto SDK. Its [KQL-to-SQL translator](https://github.com/Jiayang-Lai/kql-to-sql) is a fork of work by [saoc90](https://github.com/saoc90).

## Choose a connection mode

| Mode | Executes KQL | Data location | Requires a service | Best for |
| --- | --- | --- | --- | --- |
| **Emulated** | Supported KQL subset | Browser memory or private browser storage | No | Trying Kite and working with local datasets |
| **Mock** | No | Built-in catalog | No | Exploring the interface and editor features |
| **Local Kustainer** | Yes | Local Kustainer instance | Yes | More complete local Kusto workflows |
| **Azure Log Analytics** | Yes | Azure Log Analytics workspace | Yes | Querying a workspace through Microsoft Entra |

Hosted Azure Data Explorer and other remote Kusto clusters are not yet supported. Azure Log Analytics is supported as a query-only connection; Kusto management commands, schema changes, and ingestion are unavailable. When adding one, supply the workspace ID, workspace ARM resource ID, tenant, and a public SPA app registration's client ID. Register Kite's root and `/auth/callback` URLs as SPA redirect URIs, then grant the signed-in user access to the workspace. Kite uses Entra PKCE popup sign-in and never accepts or stores client secrets.

## Try Kite

Open [kite.humblehamster.com](https://kite.humblehamster.com/) and select **Emulated cluster**. Kite translates submitted KQL to DuckDB SQL, executes it in an isolated DuckDB-WASM worker, and displays the result in the standard result drawer. Your data remains in the browser.

Use **Admin → Databases & tables** to create schemas and **Admin → Data ingestion** to append inline CSV or a local or remote CSV/Parquet file. Kusto dot commands are unavailable in this mode.

The built-in emulated cluster is ephemeral. Custom emulated connections use persistent browser storage by default, but that storage remains private to the current site and browser profile and is not a backup.

Start with [Create a table and ingest CSV](docs/avro-emulated-quick-start.md), or read [Browser-emulated cluster](docs/emulated-cluster.md) for capabilities, limitations, persistence, and troubleshooting.

## Self-host Kite

Run the published container with Docker or Podman:

```bash
docker pull ghcr.io/jiayang-lai/kite:latest
docker run --rm -p 3000:8080 ghcr.io/jiayang-lai/kite:latest
```

Open <http://localhost:3000>. Use a version tag such as `v0.0.9` instead of `latest` to pin a release.

See [Self-hosting Kite](docs/self-hosting.md) for Podman, source builds, health checks, and local Kustainer configuration.

## Develop Kite

Requirements: [Node.js](https://nodejs.org/) 22 or later and npm.

```bash
git clone https://github.com/Jiayang-Lai/Kite.git
cd Kite
npm ci
npm run dev
```

Open the URL printed by Vite, usually <http://localhost:5173>. Development mode works with the Mock cluster and local Kustainer without a translator artifact. Building and using browser emulation locally also requires the .NET 10 SDK, the `wasm-tools` workload, and the translator submodule.

See [Development guide](docs/development.md) for translator setup, production builds, tests, and the complete command reference.

## Documentation

- [Browser-emulated cluster](docs/emulated-cluster.md) — capabilities, persistence, ingestion, and limitations
- [Table and CSV ingestion quick start](docs/avro-emulated-quick-start.md) — create a table, load sample data, and query it
- [Self-hosting Kite](docs/self-hosting.md) — containers, health checks, source builds, and Kustainer
- [Development guide](docs/development.md) — local development, WASM builds, validation, and scripts
- [Architecture and implementation](docs/architecture.md) — application layers, connection runtimes, state, and data flows
- [Terminology and glossary](docs/terminology.md) — connection kinds, capabilities, schemas, storage, and ingestion
- [Entra authentication for Log Analytics](docs/azure-entra-log-analytics-auth.md) — users, app registrations, delegated permissions, and workspace access
- [Kusto documentation pipeline](docs/kusto-documentation.md) — indexing, downloads, throttling, caching, and troubleshooting
- [Azure Log Analytics browser authentication](docs/log-analytics-authentication.md) — Entra sign-in, tokens, and workspace RBAC
- [CI/CD strategy](docs/ci-cd.md) — branches, preview environments, releases, and rollback
- [Infrastructure](infra/README.md) — deployment configuration

## License

Kite is available under the [MIT License](LICENSE).
