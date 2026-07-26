# GitHub repository infrastructure

This Terraform root manages the GitHub-side controls used by Kite's CI/CD process:

- repository merge settings and the `main` default branch;
- the `preview`, `integration-uat`, `release-candidate`, and `production` environments;
- deployment source policies for those environments;
- non-secret Cloudflare GitHub Actions variables;
- the environment-specific Cloudflare Pages branch aliases;
- the protected `main` branch ruleset; and
- the protected `v*` release-tag ruleset.

It adopts the existing `Jiayang-Lai/Kite` repository through a Terraform import block. The
repository resource also has `prevent_destroy`, so Terraform cannot delete or archive it through a
normal destroy operation.

## Secret boundary

This root does not accept or store `CLOUDFLARE_API_TOKEN`. The separate `infra/cloudflare` root
generates a least-privilege account-owned Cloudflare token and synchronizes it to these environment
secrets:

- `preview`
- `integration-uat`
- `release-candidate`
- `production`

The generated token necessarily exists in the protected Cloudflare Terraform state. Keeping that
state separate lets routine GitHub repository changes avoid access to Cloudflare credentials. The
environments prevent the token from being exposed to a job targeting a different environment.

`CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_PAGES_PROJECT_NAME` are identifiers rather than
credentials, so Terraform stores them as repository Actions variables. `CLOUDFLARE_PAGES_BRANCH`
is environment-specific.

## State and authentication

Configure an encrypted remote backend with locking before the first apply. One starting template is
provided in `backend.tf.example`; copy it to `backend.tf` and replace its placeholders, or configure
your organisation's existing Terraform backend. Do not commit backend credentials, local state, or
saved plan files.

Authenticate the GitHub provider through its environment variables rather than a Terraform
variable:

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

`Administration` covers repository settings, environments, deployment policies, the default branch,
and repository rulesets. `Environments` covers environment variables, while `Variables` covers the
repository-level Actions variables.

Do not grant Actions, Contents, Secrets, or other repository permissions unless a later Terraform
resource specifically requires them. For routine automation, prefer a dedicated GitHub App and
short-lived installation tokens over a personal access token.

## First apply

Create a local values file:

```bash
cp terraform.tfvars.example terraform.tfvars
```

Set the Cloudflare account, Pages project, and the branch configured as production in Cloudflare
Pages. Then initialise, format, validate, and review the plan:

```bash
terraform init
terraform fmt -check -recursive
terraform validate
terraform plan -out=tfplan
terraform apply tfplan
```

The first plan imports the existing repository and creates the environments, variables, deployment
policies, and rulesets. Inspect it carefully: the repository resource intentionally changes the
allowed merge methods to squash only, enables automatic branch updates and auto-merge, and deletes
short-lived branches after merge.

After this root is applied, apply `infra/cloudflare` to adopt the Pages project, generate the
deployment token, and populate all four environment secrets.

## Review and release policy

The defaults suit a solo-maintained repository:

- pull requests are required, but an approving review is not;
- review conversations must be resolved;
- `Validate` must pass against the latest `main`;
- only squash merge is permitted;
- direct pushes, force pushes, and deletion of `main` are blocked;
- the repository owner is the required production reviewer and may self-approve; and
- the repository administrator role is the only release-tag ruleset bypass, allowing maintainers to
  create tags while the release policy prohibits moving or deleting published tags.

When another maintainer is available, set:

```hcl
required_approving_review_count = 1
require_last_push_approval      = true
production_reviewer_user_ids    = [12345678]
production_prevent_self_review  = true
```

Do not make Terraform's own automation an unrestricted bypass actor. Infrastructure changes should
use the same pull-request and review path as application changes.

GitHub cannot give the administrator bypass permission for tag creation without also allowing tag
updates and deletion. Those exceptional operations are visible in the repository audit history but
remain a process control. If strict technical immutability becomes necessary, replace the
administrator bypass with a dedicated release GitHub App and create tags only through that app.

## Deployment-policy limitation

GitHub environment deployment policies use glob patterns, not regular expressions. The production
policy therefore admits version-shaped `v*.*.*` tag refs at the environment boundary. The release
workflow remains the stricter gate: it classifies tags with the committed validator and runs the
production job only for exact stable semantic-version tags. RC tags run only the release-candidate
job.

The `preview` environment admits `main`, rather than pull-request merge refs, because its
credential-bearing `Preview` workflow is triggered through `workflow_run` and executes from the
trusted default branch. That workflow verifies the originating run is successful and belongs to
the current revision of an open, same-repository pull request targeting `main` before deploying the
validated artifact. It uses the environment for its branch policy and secret access with automatic
deployment creation disabled, then creates a transient GitHub Deployment against the verified PR
head SHA so GitHub associates the status and preview URL with the pull request.

The tag ruleset similarly targets `v*`. GitHub's tag-name regex rule is available only to
enterprise-owned repositories, so the strict `vMAJOR.MINOR.PATCH[-rc.N]` syntax continues to be
enforced by the release workflow.
