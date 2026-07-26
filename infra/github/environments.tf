locals {
  deployment_environments = toset([
    "preview",
    "integration-uat",
    "release-candidate",
  ])

  cloudflare_pages_branches = {
    integration-uat   = "uat"
    release-candidate = "release-candidate"
    production        = var.cloudflare_pages_production_branch
  }
}

resource "github_repository_environment" "deployment" {
  for_each = local.deployment_environments

  repository        = github_repository.kite.name
  environment       = each.value
  can_admins_bypass = false

  deployment_branch_policy {
    protected_branches     = false
    custom_branch_policies = true
  }
}

resource "github_repository_environment" "production" {
  repository          = github_repository.kite.name
  environment         = "production"
  can_admins_bypass   = false
  prevent_self_review = var.production_prevent_self_review

  reviewers {
    users = var.production_reviewer_user_ids
  }

  deployment_branch_policy {
    protected_branches     = false
    custom_branch_policies = true
  }
}

resource "github_repository_environment_deployment_policy" "preview" {
  repository     = github_repository.kite.name
  environment    = github_repository_environment.deployment["preview"].environment
  branch_pattern = "main"
}

resource "github_repository_environment_deployment_policy" "integration_uat" {
  repository     = github_repository.kite.name
  environment    = github_repository_environment.deployment["integration-uat"].environment
  branch_pattern = "main"
}

resource "github_repository_environment_deployment_policy" "release_candidate" {
  repository  = github_repository.kite.name
  environment = github_repository_environment.deployment["release-candidate"].environment
  tag_pattern = "v*-rc.*"
}

resource "github_repository_environment_deployment_policy" "production" {
  repository  = github_repository.kite.name
  environment = github_repository_environment.production.environment
  tag_pattern = "v*.*.*"
}

resource "github_actions_variable" "cloudflare_account_id" {
  repository    = github_repository.kite.name
  variable_name = "CLOUDFLARE_ACCOUNT_ID"
  value         = var.cloudflare_account_id
}

resource "github_actions_variable" "cloudflare_pages_project_name" {
  repository    = github_repository.kite.name
  variable_name = "CLOUDFLARE_PAGES_PROJECT_NAME"
  value         = var.cloudflare_pages_project_name
}

resource "github_actions_environment_variable" "cloudflare_pages_branch" {
  for_each = local.cloudflare_pages_branches

  repository    = github_repository.kite.name
  environment   = each.key
  variable_name = "CLOUDFLARE_PAGES_BRANCH"
  value         = each.value

  depends_on = [
    github_repository_environment.deployment,
    github_repository_environment.production,
  ]
}
