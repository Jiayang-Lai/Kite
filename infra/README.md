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
| `infra/github` | Fine-grained GitHub personal access token or GitHub App installation token | Set `GITHUB_TOKEN` in `infra/github/.env` | Only the `Kite` repository; Administration, Environments, and Variables with read/write access; Metadata read-only |
| `infra/cloudflare` | Bootstrap Cloudflare API token | Set `CLOUDFLARE_API_TOKEN` in `infra/cloudflare/.env` | Account-scoped Account API Tokens Write and Pages Write; creating the account-owned deployment token requires a Cloudflare account Super Administrator |
| `infra/cloudflare` | Separate fine-grained GitHub personal access token or GitHub App installation token | Set `GITHUB_TOKEN` in `infra/cloudflare/.env` | Only the `Kite` repository; Environments read/write and Metadata read-only |

These are provider credentials, not Terraform input values. Account, subscription, repository, and resource identifiers belong in each root's `terraform.tfvars`; remote-state backend credentials must be configured separately for the selected backend. Use separate GitHub credentials for the GitHub and Cloudflare roots when practical, and keep all tokens out of Terraform variables, committed files, shell history, and saved plan output.

## Running Terraform

From the repository root, use the target for the required infrastructure and operation:

```sh
make tf-github-init
make tf-github-plan
make tf-github-apply

make tf-cloudflare-init
make tf-cloudflare-plan
make tf-cloudflare-apply

make tf-azure-init
make tf-azure-plan
make tf-azure-apply
```

The generic targets remain available when needed, for example `make tf-plan TF_ROOT=infra/github`. GitHub and Cloudflare targets require a trusted `.env` file in the selected root; Azure targets use the Azure CLI identity and load `infra/azure/.env` only when that file exists. The targets export loaded assignments only inside the Make recipe's child shell and unset the known token variables when Terraform exits. The `.env` files are ignored by Git. Do not use an untrusted `.env` file because loading it executes shell syntax.

If Terraform is invoked directly instead, remove credentials from the current shell after it completes with `unset GITHUB_TOKEN CLOUDFLARE_API_TOKEN`.

The roots use separate state because the Cloudflare state contains the generated deployment-token value. Access to that state should be substantially narrower than access to repository-governance state.

Apply them in this order:

1. `infra/github`, which creates the GitHub environments and non-secret configuration.
2. `infra/cloudflare`, which adopts the Pages resources and populates the environment secrets.

The Azure root is independent of the GitHub and Cloudflare roots. Apply it after choosing the deployed Kite origins to register as Entra SPA redirect URIs.

Each root contains its own `README.md`, provider lock file, values example, and remote-backend template. Run Terraform from within the relevant root rather than from `infra`.
