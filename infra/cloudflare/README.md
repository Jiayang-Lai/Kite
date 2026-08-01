# Cloudflare infrastructure

This Terraform root:

- adopts the existing `kite` direct-upload Cloudflare Pages project;
- manages its production branch;
- adopts the existing `kite.humblehamster.com` Pages domain attachment;
- creates an account-owned API token with only the account-scoped `Pages Write` permission; and
- stores that generated token as `CLOUDFLARE_API_TOKEN` in all four GitHub deployment environments.

DNS is intentionally outside this root. The existing DNS record for the custom domain is not changed.

## State is a secret

Cloudflare returns an API token's value only when the token is created. Terraform therefore retains the generated value in state so it can synchronize the GitHub environment secrets. Marking an output sensitive hides it from normal CLI output but does not remove it from state.

Configure an encrypted remote backend with locking and tightly restricted access before applying this root. A starting template is provided in `backend.tf.example`; copy it to `backend.tf` and replace the placeholders, or use your existing remote backend. Do not commit local state, backend credentials, saved plans, or generated token values.

## Bootstrap credentials

Terraform needs two credentials for the initial and subsequent runs:

```bash
export CLOUDFLARE_API_TOKEN="<bootstrap Cloudflare token>"
export GITHUB_TOKEN="<GitHub token or App installation token>"
```

The Cloudflare bootstrap identity needs:

- `Account API Tokens Write`, to discover permission groups and create the account-owned deployment token; and
- `Pages Write`, to import and manage the existing Pages project and domain attachment.

Creating an account-owned token requires a Cloudflare account Super Administrator. Keep the bootstrap credential in a secure operator or IaC runner secret store. Do not replace it with the generated deployment token: the generated token deliberately has only `Pages Write` and cannot manage API tokens.

For the GitHub credential, create a fine-grained personal access token with:

- resource owner: `Jiayang-Lai`;
- repository access: **Only select repositories** → `Kite`;
- repository permission: **Environments — Read and write**; and
- repository permission: **Metadata — Read-only**, which GitHub grants automatically.

No Actions, Administration, Contents, Secrets, or Variables permission is needed by this root. GitHub categorizes environment-secret public-key access and updates under the `Environments` permission rather than the `Secrets` permission.

Apply the `infra/github` root first so the four target environments already exist.

## First apply

Create a local values file and set the actual Cloudflare account ID:

```bash
cp terraform.tfvars.example terraform.tfvars
```

Confirm that `pages_production_branch` matches the production branch configured on the existing Pages project. Then initialise, format, validate, and inspect the plan:

```bash
terraform init
terraform fmt -check -recursive
terraform validate
terraform plan -out=tfplan
terraform apply tfplan
```

The first apply imports the existing Pages project and custom-domain attachment, creates the least-privilege deployment token, and replaces `CLOUDFLARE_API_TOKEN` in each GitHub environment with that token.

Cloudflare cannot import a Pages project that contains secret Pages environment variables. If the import reports that condition, do not remove those values blindly. Decide whether they should be migrated to a separate secret-management process before continuing.

If permission-group discovery reports zero Pages Write matches, verify that the bootstrap token was created for the same account as `cloudflare_account_id` and has `Account API Tokens Read` or `Account API Tokens Write`. The Terraform configuration uses Cloudflare's permission-group list data source with URL-encoded `Pages Write` and account-scope filters. A successful direct API response should contain exactly one matching group in its `result` array.

## Token rotation

Policy changes do not necessarily change the secret value. Explicitly replace the token when rotating it:

```bash
terraform plan \
  -replace=cloudflare_account_token.github_actions_pages \
  -out=tfplan
terraform apply tfplan
```

The token uses `create_before_destroy`, and the GitHub secrets depend on its value. Terraform therefore creates the replacement and updates all four environment secrets before deleting the superseded token. Afterward, run a non-production deployment and confirm that the new credential works. If it does not, use the bootstrap identity to create another replacement.

The token permission is account-scoped because Cloudflare Pages does not expose a per-Pages-project token resource scope. Its single `Pages Write` permission is the narrowest permission that supports Wrangler Pages deployments.

The sensitive token can be retrieved for break-glass use:

```bash
terraform output -raw deployment_api_token
```

Avoid doing this during normal operation because terminal output may be captured in shell history, logs, or screen recordings.
