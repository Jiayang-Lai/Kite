<!--
The pull request is squash merged, so its title becomes the commit message on main.
Write the title as a short, imperative summary of the change, for example
"Fix escaping of apostrophes in table names".
-->

## Summary

<!-- What does this change do, and why? Link related issues with "Fixes #123" where applicable. -->

## Changes

<!-- The notable changes, for reviewers. Leave out anything obvious from the diff. -->

-

## Testing

<!--
How you checked the change works, against the acceptance criteria in docs/code-standards.md.
Name the test that fails without the change, and the connection kinds you tried by hand.
List any check you didn't run as not run.
-->

- [ ] `npm run test:ci` passes locally, or CI is relied on for the parts not run (say which)
- [ ] Checked in the preview deployment, where the change is visible in the app

## Risk

<!--
Tick what applies and explain below. Delete this section if nothing applies.
-->

- [ ] Changes GitHub workflows, Terraform under `infra/`, or release scripts
- [ ] Changes authentication, credentials, or security headers such as the Content Security Policy
- [ ] Changes stored data or settings in a way that existing users will notice
- [ ] Adds or upgrades a dependency

## Checklist

- [ ] `CHANGELOG.md` describes user-facing changes, or there are none
- [ ] Documentation under `docs/` or in a README is updated, or nothing changed that it describes
- [ ] Generated files are current (`npm run check:generated`)
- [ ] Every changed line is covered (`npm run coverage:patch` after `npm run test:coverage`)
