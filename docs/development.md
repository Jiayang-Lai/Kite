# Development guide

## Prerequisites

- [Node.js](https://nodejs.org/) 22 or later
- npm
- Optional: a local Kustainer instance for executing Kusto queries
- Optional: the .NET 10 SDK and `wasm-tools` workload for rebuilding the KQL translator

## Run the development server

```bash
git clone https://github.com/Jiayang-Lai/Kite.git
cd Kite
npm ci
npm run dev
```

Open the URL printed by Vite, usually <http://localhost:5173>. Kite initially selects its built-in **Mock cluster**, which supports schema browsing and editor language features but does not execute queries.

Development mode remains available for Mock and local Kustainer connections without a locally generated translator artifact.

## Build the KQL translator

The translator source is pinned as a Git submodule, and its generated output is ignored by Git. Initialize the submodule and build the bridge before using browser emulation locally or creating a production build:

```bash
git submodule update --init --recursive
dotnet workload restore vendor/kql-to-sql/src/KqlWasmBridge/KqlWasmBridge.csproj
npm run build:kql-wasm
```

`npm run build` verifies that the generated framework files are present before producing a deployable application.

## Validate a change

Run the checks relevant to the change, or use the complete local CI suite:

```bash
npm run check
npm run lint
npm run test:unit:run
npm run build
npm run test:e2e:run
```

```bash
npm run test:ci
```

Install Playwright's Chromium browser and system dependencies before the first end-to-end test run:

```bash
npm run test:e2e:install
```

## Available scripts

| Command                           | Description                                           |
| --------------------------------- | ----------------------------------------------------- |
| `npm run dev`                     | Start the development server                          |
| `npm run build`                   | Generate sources and create a production build        |
| `npm run build:container`         | Create the static production build for a container    |
| `npm run build:kql-wasm`          | Build the vendored KQL translator bridge              |
| `npm run preview`                 | Preview the production build locally                  |
| `npm run check`                   | Run Svelte and TypeScript checks                      |
| `npm run lint`                    | Check formatting with Prettier                        |
| `npm run lint:ci`                 | Check formatting for files enforced by CI             |
| `npm run test:unit:run`           | Run unit tests once                                   |
| `npm run test:e2e:install`        | Install Playwright Chromium and system dependencies   |
| `npm run test:e2e`                | Build the app and run end-to-end tests                |
| `npm run test:e2e:run`            | Run end-to-end tests against an existing build        |
| `npm run test:ci`                 | Run the complete local CI validation suite            |
| `npm run security:audit`          | Audit production dependencies                         |
| `npm run generate`                | Regenerate committed TypeScript from committed inputs |
| `npm run check:generated`         | Verify that committed generated TypeScript is current |
| `npm run download:kusto-docs`     | Download missing Markdown from the committed index    |
| `npm run update:kusto-docs-index` | Refresh the reviewed Kusto index snapshot             |

For deployment and release behavior, see the [CI/CD strategy](ci-cd.md).
