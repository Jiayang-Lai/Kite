# Kite

<p align="center">
  <img src="docs/.pics/kite.svg" alt="Kite application icon" width="128" height="128">
</p>

[![Main UAT](https://github.com/Jiayang-Lai/Kite/actions/workflows/main-uat.yml/badge.svg?branch=main&event=push)](https://github.com/Jiayang-Lai/Kite/actions/workflows/main-uat.yml)
[![Website](https://img.shields.io/website?url=https%3A%2F%2Fkite.humblehamster.com&label=website)](https://kite.humblehamster.com/)
[![License: MIT](https://img.shields.io/github/license/Jiayang-Lai/Kite)](LICENSE)
[![Node.js >=22](https://img.shields.io/badge/Node.js-%3E%3D22-339933?logo=nodedotjs&logoColor=white)](package.json)

A focused, browser-based workspace for exploring data and operating local
[Kusto](https://learn.microsoft.com/kusto/) clusters.

[Try Kite online](https://kite.humblehamster.com/)

> [!NOTE]
> Kite is currently in alpha.

## About

Kite brings KQL authoring, schema exploration, and cluster administration into one interface. It
includes a Monaco-powered query editor with Kusto language support and a built-in mock catalog, so
you can explore the application without configuring a backend.

With Kite, you can:

- Browse clusters, databases, tables, functions, and schemas.
- Write and format KQL with completion, validation, hover help, and inline documentation.
- Run queries and inspect their results.
- Save queries and revisit recent work in browser storage.
- Execute management commands and manage database tables.
- Ingest inline CSV, browser-selected CSV, and files mounted into a local Kustainer instance.

Kite is built with SvelteKit, TypeScript, Tailwind CSS, Monaco Editor, and the Azure Kusto SDK.

## Getting started

### Prerequisites

- [Node.js](https://nodejs.org/) 22 or later
- npm
- Optional: a browser-accessible Kusto endpoint for executing queries

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

Kite opens with its built-in **Mock cluster** selected. The mock catalog supports schema browsing
and editor language features, but it does not execute queries.

### Connect to local Kusto

Kite includes a **Local Kusto** connection for `http://localhost:8080`. Start a
[Kustainer](https://learn.microsoft.com/azure/data-explorer/kustainer) instance on that address,
then select **Local Kusto** from Kite's cluster selector to run queries and management commands.

For mounted-file ingestion, mount a host directory at `/kustodata/raw`:

```yaml
services:
  kusto:
    image: mcr.microsoft.com/azuredataexplorer/kustainer-linux
    ports:
      - '127.0.0.1:8080:8080'
    volumes:
      - ./kusto-raw:/kustodata/raw
    environment:
      - ACCEPT_EULA=Y
```

The Kusto endpoint must allow requests from Kite's browser origin through CORS. Kustainer does not
provide authentication or an encrypted connection, so keep it bound to your local machine.

You can also add another browser-accessible endpoint from the cluster settings. Custom connections
are saved only in your browser.

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
