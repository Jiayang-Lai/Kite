# Kite

<p align="center">
  <img src="docs/.pics/kite.svg" alt="Kite application icon" width="128" height="128">
</p>

[![Latest release](https://img.shields.io/github/v/release/Jiayang-Lai/Kite?display_name=tag&sort=semver)](https://github.com/Jiayang-Lai/Kite/releases/latest) [![Main UAT](https://github.com/Jiayang-Lai/Kite/actions/workflows/main-uat.yml/badge.svg?branch=main&event=push)](https://github.com/Jiayang-Lai/Kite/actions/workflows/main-uat.yml) [![Website](https://img.shields.io/website?url=https%3A%2F%2Fkite.humblehamster.com&label=website)](https://kite.humblehamster.com/) [![License: MIT](https://img.shields.io/github/license/Jiayang-Lai/Kite)](LICENSE) [![Node.js >=22](https://img.shields.io/badge/Node.js-%3E%3D22-339933?logo=nodedotjs&logoColor=white)](package.json)

A local-first [Kusto](https://learn.microsoft.com/kusto/) application for exploring data, writing KQL, and operating clusters without any cloud-hosted infrastructure — including a browser-based Kusto emulation mode that runs KQL with no Kusto server to install.

[Try Kite online](https://kite.humblehamster.com/)

<!-- prettier-ignore -->
> [!NOTE]
> Kite is currently in alpha.

<!-- prettier-ignore -->
> [!WARNING]
> Kite is evolving rapidly. Always maintain a separate backup of your Kustainer data and saved queries, especially before updating or reconfiguring the application. Do not rely on Kite or its local storage as the only copy of important data.

<!-- prettier-ignore -->
> [!IMPORTANT]
> Kite currently supports three connection modes:
>
> - **Mock** provides schema browsing and editor language features, but cannot execute queries.
> - **Emulated** translates KQL to SQL and executes it with DuckDB-WASM entirely in the browser.
> - **Remote** can execute queries, but currently supports only a Kustainer instance running on the local machine. Hosted Azure Data Explorer and other remote Kusto clusters are not yet supported.

<!-- prettier-ignore -->
> [!TIP]
> **Run KQL entirely in your browser.** Select **Emulated cluster** to translate KQL to DuckDB SQL and execute it in DuckDB-WASM. It is Kite's fastest way to get from an empty browser tab to a working local KQL workspace—no Kustainer, container, or cloud account required.

## About

Kite makes the Kusto workflow available entirely on your own machine. Its browser-only emulated cluster lets you query data, explore schemas, administer databases, and ingest files without provisioning Azure Data Explorer, starting a server, or sending data to a cloud service. When you need a local Kusto service, you can also pair the workspace with Kustainer. The hosted Kite site is optional.

Kite brings KQL authoring, schema exploration, and cluster administration into one interface. It includes a Monaco-powered query editor with Kusto language support, a built-in mock catalog, and an in-browser DuckDB backend powered by the [KQL-to-SQL translator](https://github.com/Jiayang-Lai/kql-to-sql).

<!-- prettier-ignore -->
> [!NOTE]
> Kite's KQL-to-SQL translator is a fork of work by [saoc90](https://github.com/saoc90). Thank you for making the original project available.

### Browser-based Kusto emulation

The **Emulated cluster** is a local KQL execution environment built into Kite. Submitted KQL is translated to DuckDB SQL by Kite's [KQL-to-SQL translator](https://github.com/Jiayang-Lai/kql-to-sql) and run in an isolated DuckDB-WASM worker. You can use it online or self-hosted; your data stays in the browser's memory or private browser storage.

It is ideal for trying Kite, prototyping KQL, building a small local data workspace, and working without Docker. It intentionally differs from a full Kusto service: supported KQL is limited by the translator, and Kusto dot commands are unavailable. See [Browser-emulated cluster](docs/emulated-cluster.md) for the capability matrix and details.

With Kite, you can:

- Browse clusters, databases, tables, functions, and schemas.
- Write and format KQL with completion, validation, hover help, and inline documentation.
- Run KQL against Kusto or translate it to DuckDB SQL and execute it in the browser.
- Save queries and revisit recent work in browser storage.
- Execute Kusto management commands or use structured browser-local database and table administration.
- Ingest inline CSV, browser-selected CSV/Parquet, mounted files, and remote HTTP(S) files where supported.

Kite is built with SvelteKit, TypeScript, Tailwind CSS, Monaco Editor, DuckDB-WASM, and the Azure Kusto SDK.

## Getting started

### Prerequisites

- [Node.js](https://nodejs.org/) 22 or later
- npm
- Optional: a local Kustainer instance for executing queries
- Optional: the .NET 10 SDK and `wasm-tools` workload when rebuilding the KQL translator

### Run locally

Clone the repository and install its dependencies:

```bash
git clone https://github.com/Jiayang-Lai/Kite.git
cd Kite
npm ci
```

Start the development server:

```bash
npm run dev
```

Open the URL shown in the terminal, usually <http://localhost:5173>.

Kite opens with its built-in **Mock cluster** selected. The mock catalog supports schema browsing and editor language features, but it does not execute queries.

### Quick starts

- [Create a table and ingest CSV in the emulated cluster](docs/avro-emulated-quick-start.md)

### Use the browser-emulated cluster

Select **Emulated cluster** from the cluster selector to run KQL without a Kusto server. Kite:

1. Loads the translator from `/kql-wasm/_framework`.
2. Translates submitted KQL to the DuckDB SQL dialect.
3. Executes the SQL in an isolated DuckDB-WASM worker.
4. Displays the result through the same result drawer used for Kusto queries.

Use **Admin → Databases & tables** to create databases and tables or update table schemas. Use **Admin → Data ingestion** to append inline CSV, a local CSV/Parquet file, or a remote CSV/Parquet file. Kusto dot commands are intentionally unavailable for emulated clusters.

Custom emulated clusters use **Persistent browser storage** by default, storing their DuckDB cluster file in OPFS so databases, tables, and ingested rows survive cluster switches and reloads. Persistent data is private to the current site and browser profile; removing that connection deletes its local files. Persistent logical databases are isolated as DuckDB schemas inside one cluster file. The built-in emulated cluster and custom clusters created with **Ephemeral memory** instead keep databases in WASM memory. Switching clusters, leaving the workspace, or reloading releases the worker and clears that ephemeral data.

Only the selected emulated connection owns a DuckDB worker and memory allocation. Persistence does not remove the selected cluster's runtime memory requirements.

See [Browser-emulated cluster](docs/emulated-cluster.md) for the capability matrix, ingestion behavior, memory model, and troubleshooting notes.

### Build the KQL translator WASM

The translator source is pinned as a Git submodule and its generated output remains ignored by Git. Initialize the submodule and build the bridge before running a production build:

```bash
git submodule update --init --recursive
dotnet workload restore vendor/kql-to-sql/src/KqlWasmBridge/KqlWasmBridge.csproj
npm run build:kql-wasm
```

`npm run build` checks that the generated framework files are present before producing a deployable application. `npm run dev` remains available for Mock and remote clusters without this optional local artifact.

### Run with Docker or Podman

Docker and Podman both build the vendored KQL translator WASM and the container-targeted Kite frontend, including the local DuckDB-WASM assets. Initialize the submodule once so its source is available in the build context; you do not need to install Node.js or .NET locally.

```bash
git submodule update --init --recursive
```

With Docker:

```bash
docker build -t kite:local .
docker run --rm -p 3000:8080 kite:local
```

Tagged releases are also published to GitHub Container Registry:

```bash
podman pull ghcr.io/jiayang-lai/kite:latest
podman run --rm -p 3000:8080 ghcr.io/jiayang-lai/kite:latest
```

Use a version tag such as `v0.0.4` instead of `latest` to pin a release.

With Podman (including rootless Podman):

```bash
podman build --format docker -t kite:local .
podman run --rm -p 3000:8080 kite:local
```

The Docker image format keeps the Dockerfile health check; Podman's default OCI image format does not support that metadata.

The container build compiles the translator directly from `vendor/kql-to-sql`; it performs no Git operations. It downloads application dependencies and any Kusto documentation missing from `static/kusto-docs`, so a clean build still requires network access. CI restores that directory from its shared Kusto documentation cache before building the image. The final image contains only the generated static application and an unprivileged nginx server.

Open <http://localhost:3000>. The container listens on port `8080`; mapping it to host port `3000` leaves `localhost:8080` available for Kite's built-in local Kustainer connection. Use `/healthz` for container health checks.

### Connect to local Kusto

Kite includes a **Local Kusto** connection for `http://localhost:8080`. Start a [Kustainer](https://learn.microsoft.com/en-us/azure/data-explorer/kusto-emulator-install) instance on that address, then select **Local Kusto** from Kite's cluster selector to run queries and management commands.

For mounted-file ingestion, mount a host directory at `/kustodata/raw`:

```yaml
services:
  kusto:
    image: mcr.microsoft.com/azuredataexplorer/kustainer-linux
    ports:
      - '127.0.0.1:8080:8080'
    volumes:
      - kustodata:/kustodata
    environment:
      - ACCEPT_EULA=Y
    restart: always
```

The Kusto endpoint must allow requests from Kite's browser origin through CORS. Kustainer does not provide authentication or an encrypted connection, so keep it bound to your local machine.

Kite labels executable connections as **Remote** because queries are sent to a Kusto HTTP endpoint. At present, this mode supports only a local Kustainer endpoint.

If you are interested in more self-hosted Kusto examples and a Docker-based local lab, check out my other repo [100 Days of KQL](https://github.com/Jiayang-Lai/100-Days-of-KQL).

## Available scripts

| Command                       | Description                                           |
| ----------------------------- | ----------------------------------------------------- |
| `npm run dev`                 | Start the development server                          |
| `npm run build`               | Generate Kusto docs and create a production build     |
| `npm run build:container`     | Create the static production build for a container    |
| `npm run preview`             | Preview the production build locally                  |
| `npm run check`               | Run Svelte and TypeScript checks                      |
| `npm run lint`                | Check formatting with Prettier                        |
| `npm run lint:ci`             | Check formatting for files currently enforced by CI   |
| `npm run test:unit:run`       | Run unit tests once                                   |
| `npm run test:e2e:install`    | Install Playwright Chromium and system dependencies   |
| `npm run test:e2e`            | Build the app and run end-to-end tests                |
| `npm run test:e2e:run`        | Run end-to-end tests against an existing build        |
| `npm run test:ci`             | Run the complete local CI validation suite            |
| `npm run security:audit`      | Audit production dependencies                         |
| `npm run generate:kusto-docs` | Refresh the bundled Kusto documentation and its index |

## License

Kite is available under the [MIT License](LICENSE).
