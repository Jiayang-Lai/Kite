# GitHub repository infrastructure

This Terraform root manages the GitHub-side controls used by Kite's CI/CD process:

- repository About metadata (description, website, and topics);
- repository merge settings and the `main` default branch;
- the `preview`, `integration-uat`, `release-candidate`, and `production` environments;
- the `release-tagging` environment and its `RELEASE_TAG_APP_ID` variable;
- deployment source policies for those environments;
- non-secret Cloudflare GitHub Actions variables;
- the environment-specific Cloudflare Pages branch aliases;
- the protected `main` branch ruleset; and
- the protected `v*` release-tag ruleset, whose only bypass is the release-tag GitHub App.

It adopts the existing `Jiayang-Lai/Kite` repository through a Terraform import block. The repository resource also has `prevent_destroy`, so Terraform cannot delete or archive it through a normal destroy operation.

## Secret boundary

This root does not accept or store `CLOUDFLARE_API_TOKEN`. The separate `infra/cloudflare` root generates a least-privilege account-owned Cloudflare token and synchronizes it to these environment secrets:

- `preview`
- `integration-uat`
- `release-candidate`
- `production`

The generated token necessarily exists in the protected Cloudflare Terraform state. Keeping that state separate lets routine GitHub repository changes avoid access to Cloudflare credentials. The environments prevent the token from being exposed to a job targeting a different environment.

This root also does not store the release-tag GitHub App's private key. Set `RELEASE_TAG_APP_PRIVATE_KEY` on the `release-tagging` environment yourself, as described in [Release-tag GitHub App](#release-tag-github-app).

`CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_PAGES_PROJECT_NAME` are identifiers rather than credentials, so Terraform stores them as repository Actions variables. `CLOUDFLARE_PAGES_BRANCH` is environment-specific.

## State and authentication

Configure an encrypted remote backend with locking before the first apply. One starting template is provided in `backend.tf.example`; copy it to `backend.tf` and replace its placeholders, or configure your organisation's existing Terraform backend. Do not commit backend credentials, local state, or saved plan files.

Authenticate the GitHub provider through its environment variables rather than a Terraform variable:

```bash
export GITHUB_TOKEN="<fine-grained token or GitHub App installation token>"
```

For a fine-grained personal access token, configure:

- resource owner: `Jiayang-Lai`;
- repository access: **Only select repositories** → `Kite`;
- repository permission: **Administration — Read and write**;
- repository permission: **Environments — Read and write**;
- repository permission: **Variables — Read and write**; and
- repository permission: **Metadata — Read-only**, which GitHub grants automatically.

`Administration` covers repository settings, environments, deployment policies, the default branch, and repository rulesets. `Environments` covers environment variables, while `Variables` covers the repository-level Actions variables.

Do not grant Actions, Contents, Secrets, or other repository permissions unless a later Terraform resource specifically requires them. For routine automation, prefer a dedicated GitHub App and short-lived installation tokens over a personal access token.

## First apply

Create a local values file:

```bash
cp terraform.tfvars.example terraform.tfvars
```

Set the Cloudflare account, Pages project, and the branch configured as production in Cloudflare Pages. Then initialise, format, validate, and review the plan:

From the repository root (each command loads the credentials from `infra/github/.env`; see [Running Terraform](../README.md#running-terraform)):

```bash
make tf ROOT=github CMD=init
make tf ROOT=github CMD="fmt -check -recursive"
make tf ROOT=github CMD=validate
make tf ROOT=github CMD="plan -out=tfplan"
make tf ROOT=github CMD="apply tfplan"
```

The first plan imports the existing repository and creates the environments, variables, deployment policies, and rulesets. Inspect it carefully: the repository resource intentionally changes the allowed merge methods to squash only, enables automatic branch updates and auto-merge, and deletes short-lived branches after merge.

After this root is applied, apply `infra/cloudflare` to adopt the Pages project, generate the deployment token, and populate all four environment secrets.

## Review and release policy

The defaults suit a solo-maintained repository:

- pull requests are required, but an approving review is not;
- review conversations must be resolved;
- `Validate` and `Validate container image` must pass against the latest `main`;
- only squash merge is permitted;
- direct pushes, force pushes, and deletion of `main` are blocked;
- the repository owner is the required production reviewer and may self-approve;
- the production approval gates both the Cloudflare Pages deployment and the signed GHCR image publication; and
- release tags can be created only by the **Create release tag** workflow through the release-tag GitHub App, once `release_tag_app_id` is set; until then, the repository administrator role remains the bypass.

When another maintainer is available, set:

```hcl
required_approving_review_count = 1
require_last_push_approval      = true
production_reviewer_user_ids    = [12345678]
production_prevent_self_review  = true
```

Do not make Terraform's own automation an unrestricted bypass actor. Infrastructure changes should use the same pull-request and review path as application changes.

## Release-tag GitHub App

The **Create release tag** workflow (`.github/workflows/create-release-tag.yml`) derives each release tag from `package.json` and creates it with a dedicated GitHub App. Making that App the ruleset's only bypass means a person cannot create, move, or delete a `v*` tag directly, and tags cannot disagree with the released version. The App token is also what lets the new tag start the Release workflow; tags created with `GITHUB_TOKEN` do not trigger workflows.

The App's configuration is code: [`release-tag-app.json`](release-tag-app.json) is a GitHub App manifest granting a single repository permission, **Contents — Read and write**, with webhooks disabled. Terraform cannot create GitHub Apps or their private keys, so a script registers the App through GitHub's manifest flow and records its App ID for Terraform. Terraform cannot look the App up by slug instead: GitHub hides private Apps from the fine-grained token this root uses.

Set it up once, with the [GitHub CLI](https://cli.github.com/) signed in as the repository owner:

1. Apply this root (`make tf ROOT=github CMD="plan -out=tfplan"`, then `make tf ROOT=github CMD="apply tfplan"`) so the `release-tagging` environment exists. While `release_tag_app_id` is unset, administrators keep the tag bypass.
2. From the repository root, run:

   ```bash
   npm run setup:release-tag-app
   ```

   Open the printed `http://localhost:47819/` link, then click **Create GitHub App** on GitHub, and then install the App on the `Kite` repository only. The script:
   - registers the App from the manifest;
   - stores its private key as the `RELEASE_TAG_APP_PRIVATE_KEY` secret on `release-tagging`, passing it directly to `gh` without writing it to disk;
   - waits for the installation and confirms it can reach `Kite`, warning if it was installed on all repositories; and
   - sets `release_tag_app_id` in `terraform.tfvars`.

   The whole flow must finish within an hour. In a dev container, VS Code forwards the callback port automatically; pass `--port <number>` to use another one.

3. Plan and apply this root again with the same two commands. Terraform sets `RELEASE_TAG_APP_ID` on the environment from the recorded ID and replaces the administrator bypass with the App.

To change the App's permissions, edit the manifest and apply the same change on the App's settings page; GitHub does not update a registered App from its manifest. To rotate the key, generate a new one on the App's settings page, store it with `gh secret set RELEASE_TAG_APP_PRIVATE_KEY --env release-tagging --repo Jiayang-Lai/Kite < key.pem`, delete the file, and then delete the old key on GitHub.

The `release-tagging` environment admits only runs from `main`, so a modified copy of the workflow on another branch cannot read the key. Anyone who can run workflows can start a release-candidate or stable tag run; production still requires the production environment approval.

For an emergency that the workflow cannot handle, set `allow_admin_release_tag_bypass = true`, apply, perform the change, then set it back to `false` and apply again. Administrator bypass covers tag creation, updates, and deletion together, so leave it off otherwise. Bypass use is recorded in the repository's rule insights and audit log.

## Deployment-policy limitation

GitHub environment deployment policies use glob patterns, not regular expressions. The production policy therefore admits version-shaped `v*.*.*` tag refs at the environment boundary. The release workflow remains the stricter gate: it classifies tags with the committed validator and runs the production job only for exact stable semantic-version tags. RC tags run only the release-candidate job.

The `preview` environment admits `main`, rather than pull-request merge refs, because its credential-bearing `Preview` workflow is triggered through `workflow_run` and executes from the trusted default branch. That workflow verifies the originating run is successful and belongs to the current revision of an open, same-repository pull request targeting `main` before deploying the validated artifact. It uses the environment for its branch policy and secret access with automatic deployment creation disabled, then creates a transient GitHub Deployment against the verified PR head SHA so GitHub associates the status and preview URL with the pull request.

The tag ruleset similarly targets `v*`. GitHub's tag-name regex rule is available only to enterprise-owned repositories, so the strict `vMAJOR.MINOR.PATCH[-rc.N]` syntax continues to be enforced by the release workflow.
