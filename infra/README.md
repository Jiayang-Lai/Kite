# Infrastructure

Kite keeps GitHub governance and Cloudflare deployment infrastructure in separate Terraform roots:

| Root               | Responsibilities                                                                    |
| ------------------ | ----------------------------------------------------------------------------------- |
| `infra/github`     | Repository settings, environments, deployment policies, variables, and rulesets     |
| `infra/cloudflare` | Existing Pages project and domain, deployment token, and GitHub environment secrets |

The roots use separate state because the Cloudflare state contains the generated deployment-token
value. Access to that state should be substantially narrower than access to repository-governance
state.

Apply them in this order:

1. `infra/github`, which creates the GitHub environments and non-secret configuration.
2. `infra/cloudflare`, which adopts the Pages resources and populates the environment secrets.

Use separate GitHub credentials for the roots when practical. The Cloudflare root needs only
`Environments: Read and write` on `Kite`; the GitHub governance root needs `Administration`,
`Environments`, and `Variables`, each with read and write access. GitHub grants `Metadata:
Read-only` automatically.

Each root contains its own `README.md`, provider lock file, values example, and remote-backend
template. Run Terraform from within the relevant root rather than from `infra`.
