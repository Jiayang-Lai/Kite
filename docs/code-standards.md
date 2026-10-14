# Code standards

These rules come from Kite's architecture and from lessons seen on three or more days in [LESSONS.md](../LESSONS.md). A reviewer checks each one, and a pull request that doesn't meet one gets a comment saying which.

## What a change contains

| Rule | What a reviewer looks at |
| --- | --- |
| A change does only what its goal needs. | Every change in behaviour has a reason. Unrelated refactors and extra features go in a pull request of their own. |
| A change keeps Kite's layers. | The capability policy in `connection-capabilities.ts` gates a UI action before it is enabled. Connection-specific behaviour sits behind `ConnectionRuntime` or the schema-mutation adapter, not in a component. Multi-step workflows live in controllers, and page components only compose and render. See [Adding a feature](architecture.md#adding-a-feature). |
| A fix reaches every connection kind and build target it applies to. | The reviewer asks whether the same bug exists in the other drivers and in the other build target. See [Which code actually runs](../AGENTS.md#which-code-actually-runs). |
| Every boundary is untrusted. | Browser storage, API responses, worker messages, imported files and downloaded inputs are validated where they enter. Malformed stored records are ignored, not trusted. |
| Results cross the UI boundary in the shared types. | Values are normalized at the SDK or API boundary into `src/lib/types` shapes: dates become ISO strings and `bigint` values become strings. |
| Destructive actions are reviewable and cancellable. | A mutation builds a plan that is reviewed before it runs. Remote schema changes that can race with other clients are preflighted against the loaded snapshot. |
| Generated files change only through their inputs. | `src/lib/generated` and other generated files are not edited by hand; `npm run check:generated` passes. |
| Words follow the terminology. | Names and user-facing text use the terms in [terminology.md](terminology.md). |
| User-facing changes are written down. | `CHANGELOG.md` describes each user-facing change, and the docs that describe the changed behaviour are updated. |
| Workflows pin what they run. | Actions are pinned to a full commit SHA with the version in a comment. A workflow that holds secrets runs only from `main` or a release tag. See [CI/CD strategy](ci-cd.md). |

## Tests

| Rule | What a reviewer looks at |
| --- | --- |
| A fix comes with a test that fails without it. | The reviewer puts the old code back and runs the test, and the test must fail. The pull request says what it failed with. |
| Tests sit beside the module they test. | `*.test.ts` next to the module. Component tests are `*.svelte.test.ts` and run in Chromium. Tests for `scripts/` run on plain Node. |
| Tests use real inputs. | Fixtures look like real Kusto and Log Analytics responses, real files and real stored records, including missing fields and empty values. Kusto names include `'` and `\`. |
| Tests check behaviour, not implementation. | Assertions are about what the user or caller needs, so refactors don't break them. |
| Coverage stays above its thresholds. | 60% globally for statements, branches, functions and lines, and the higher thresholds for library code in `vite.config.ts`. |
| Every changed line is covered, including each of its branches. | `npm run coverage:patch` prints nothing uncovered. The global thresholds hide gaps in new code, and behaviour covered only by end-to-end tests doesn't count toward coverage. Codecov marked the patch report ❌ on #68, #72, #73, #86 and #87 for exactly this. |
| End-to-end tests run under the Content Security Policy. | A violation fails the test. A `csp-known-violation` annotation explains its source and is agreed with the maintainer. |

## Acceptance criteria

A change is merged only when it shows each of the following. The pull request says which were run and what they printed. A check that wasn't run is listed as not run, never left out.

1. **A test that fails without the change.** Put the old code back and run the new test. It must fail with an assertion that names the behaviour, not a compile error or a skip. Then restore the change and check the test passes.
2. **The checks.** `npm run check`, `npm run lint`, `npm run test:coverage`, `npm run coverage:patch` and `npm run check:generated`. Run `npm run test:ci` when the change touches the build, routes, or anything an end-to-end test covers.
3. **Real use.** Try the change in `npm run dev` or the pull request's preview deployment, with each connection kind it affects. Say which kinds and build targets were tried and which weren't.
4. **The pull request template.** Its testing, risk and checklist sections are filled in.
