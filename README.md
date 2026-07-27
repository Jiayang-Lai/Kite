# Kite

<p align="center">
  <img src="docs/.pics/kite.svg" alt="Kite application icon" width="128" height="128">
</p>

[![Latest release](https://img.shields.io/github/v/release/Jiayang-Lai/Kite?display_name=tag&sort=semver)](https://github.com/Jiayang-Lai/Kite/releases/latest)
[![Main UAT](https://github.com/Jiayang-Lai/Kite/actions/workflows/main-uat.yml/badge.svg?branch=main&event=push)](https://github.com/Jiayang-Lai/Kite/actions/workflows/main-uat.yml)
[![Website](https://img.shields.io/website?url=https%3A%2F%2Fkite.humblehamster.com&label=website)](https://kite.humblehamster.com/)
[![License: MIT](https://img.shields.io/github/license/Jiayang-Lai/Kite)](LICENSE)
[![Node.js >=22](https://img.shields.io/badge/Node.js-%3E%3D22-339933?logo=nodedotjs&logoColor=white)](package.json)

A local-first [Kusto](https://learn.microsoft.com/kusto/) application for exploring data, writing KQL, and operating clusters without any cloud-hosted infrastructure.

[Try Kite online](https://kite.humblehamster.com/)

> [!NOTE]
> Kite is currently in alpha.

> [!WARNING]
> Kite is evolving rapidly. Always maintain a separate backup of your Kustainer data and saved queries, especially before updating or reconfiguring the application. Do not rely on Kite or its local storage as the only copy of important data.

> [!IMPORTANT]
> Connection support is currently limited to two modes:
>
> - **Mock** provides schema browsing and editor language features, but cannot execute queries.
> - **Remote** can execute queries, but currently supports only a Kustainer instance running on the local machine. Hosted Azure Data Explorer and other remote Kusto clusters are not yet supported.

## About

Kite makes the Kusto workflow available entirely on your own machine. Pair the browser-based workspace with a local Kustainer instance to query data, explore schemas, administer databases, and ingest files without provisioning Azure Data Explorer or sending your data to a cloud service. The hosted Kite site is optional—the application and Kusto backend can both run locally.

Kite brings KQL authoring, schema exploration, and cluster administration into one interface. It includes a Monaco-powered query editor with Kusto language support and a built-in mock catalog, so you can explore the interface even before starting a local backend.

With Kite, you can:

- Browse clusters, databases, tables, functions, and schemas.
- Write and format KQL with completion, validation, hover help, and inline documentation.
- Run queries and inspect their results.
- Save queries and revisit recent work in browser storage.
- Execute management commands and manage database tables.
- Ingest inline CSV, browser-selected CSV, mounted files, and remote HTTP(S) files.

Kite is built with SvelteKit, TypeScript, Tailwind CSS, Monaco Editor, and the Azure Kusto SDK.

## Getting started

### Prerequisites

- [Node.js](https://nodejs.org/) 22 or later
- npm
- Optional: a local Kustainer instance for executing queries

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
