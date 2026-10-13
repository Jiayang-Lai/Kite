# Changelog

All notable changes to Kite are recorded here. Kite follows [semantic versioning](https://semver.org/); while the major version is 0, minor releases may include breaking changes. Notes for releases before 0.1.0 are on the [GitHub releases page](https://github.com/Jiayang-Lai/Kite/releases).

## [0.1.0]

### Fixed

- Table, column, and database names, docstrings, folders, and display names that contain an apostrophe or a backslash now produce valid Kusto commands. Previously an apostrophe was escaped incorrectly and a trailing backslash broke the command.
- Cancelling an ingestion into a browser-emulated cluster is reported as cancelled, with the append rolled back, instead of as a failure.
- Cancelling the schema check that runs before an emulated table edit no longer shows a verification error.
- A collapsed sidebar stays collapsed after a reload.
- The container image and the hosted site now send `X-Frame-Options`, `Referrer-Policy`, and `X-Content-Type-Options` on every page. The container previously sent them only from its health check.

### Changed

- Switching connections with open queries and closing a running or unsaved query tab now ask for confirmation in an in-app dialog instead of a browser prompt.
- The Admin workspace now reloads a Log Analytics schema that is more than five minutes old, as Explorer already did.
- Avro table templates are validated by Kite itself rather than the `avsc` library. Valid templates behave as before. An object whose `type` is a one-element array, such as `{ "type": ["int"] }`, is now rejected because it is not valid Avro; write the union directly instead, for example `"type": ["int"]` on the field.

### Security

- Kite now sends a `Content-Security-Policy-Report-Only` header. It reports, but does not block, scripts, frames, and other resources outside the policy. Connections to Kusto, Log Analytics, and remote ingestion URLs remain unrestricted because they are user-configured. The policy will be enforced in a later release.

[0.1.0]: https://github.com/Jiayang-Lai/Kite/releases/tag/v0.1.0
