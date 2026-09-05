# Infrastructure

Kite keeps GitHub governance, Cloudflare deployment, and Azure Log Analytics infrastructure in separate Terraform roots:

| Root | Responsibilities |
| --- | --- |
| `infra/github` | Repository settings, environments, deployment policies, variables, and rulesets |
| `infra/cloudflare` | Existing Pages project and domain, deployment token, and GitHub environment secrets |
| `infra/azure` | Log Analytics workspace, browser-only Entra application registration, and optional query-reader role assignments |

## Terraform credentials

| Terraform root | Provider credential | Configuration | Required access |
| --- | --- | --- | --- |
| `infra/azure` | Azure CLI identity used by both `azurerm` and `azuread` | Run `az login`, then `az account set --subscription "<subscription-id>"` | Contributor plus User Access Administrator, or Owner, on the target subscription; Application Administrator or equivalent Microsoft Graph permissions in Entra |
| `infra/github` | Fine-grained GitHub personal access token or GitHub App installation token | `export GITHUB_TOKEN="<token>"` | Only the `Kite` repository; Administration, Environments, and Variables with read/write access; Metadata read-only |
| `infra/cloudflare` | Bootstrap Cloudflare API token | `export CLOUDFLARE_API_TOKEN="<token>"` | Account-scoped Account API Tokens Write and Pages Write; creating the account-owned deployment token requires a Cloudflare account Super Administrator |
| `infra/cloudflare` | Separate fine-grained GitHub personal access token or GitHub App installation token | `export GITHUB_TOKEN="<token>"` | Only the `Kite` repository; Environments read/write and Metadata read-only |

These are provider credentials, not Terraform input values. Account, subscription, repository, and resource identifiers belong in each root's `terraform.tfvars`; remote-state backend credentials must be configured separately for the selected backend. Use separate GitHub credentials for the GitHub and Cloudflare roots when practical, and keep all tokens out of Terraform variables, committed files, shell history, and saved plan output.

The roots use separate state because the Cloudflare state contains the generated deployment-token value. Access to that state should be substantially narrower than access to repository-governance state.

Apply them in this order:

1. `infra/github`, which creates the GitHub environments and non-secret configuration.
2. `infra/cloudflare`, which adopts the Pages resources and populates the environment secrets.

The Azure root is independent of the GitHub and Cloudflare roots. Apply it after choosing the deployed Kite origins to register as Entra SPA redirect URIs.

Each root contains its own `README.md`, provider lock file, values example, and remote-backend template. Run Terraform from within the relevant root rather than from `infra`.
