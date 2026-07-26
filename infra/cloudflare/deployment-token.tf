locals {
  github_deployment_environments = toset([
    "preview",
    "integration-uat",
    "release-candidate",
    "production",
  ])

  account_token_permission_groups = coalesce(
    data.cloudflare_account_api_token_permission_groups_list.available.result,
    []
  )

  pages_write_permission_groups = [
    for permission_group in local.account_token_permission_groups : permission_group
    if(
      contains(
        ["Pages Write", "Cloudflare Pages Write"],
        coalesce(permission_group.name, "")
      ) &&
      contains(
        coalesce(permission_group.scopes, []),
        "com.cloudflare.api.account"
      )
    )
  ]

  pages_write_permission_group_id = try(
    one(local.pages_write_permission_groups).id,
    ""
  )
}

data "cloudflare_account_api_token_permission_groups_list" "available" {
  account_id = var.cloudflare_account_id
  name       = "Pages%20Write"
  scope      = "com.cloudflare.api.account"
}

resource "cloudflare_account_token" "github_actions_pages" {
  account_id = var.cloudflare_account_id
  name       = var.deployment_token_name
  status     = "active"
  expires_on = var.deployment_token_expires_on

  policies = [{
    effect = "allow"
    permission_groups = [{
      id = local.pages_write_permission_group_id
    }]
    resources = jsonencode({
      "com.cloudflare.api.account.${var.cloudflare_account_id}" = "*"
    })
  }]

  lifecycle {
    create_before_destroy = true

    precondition {
      condition     = length(local.pages_write_permission_groups) == 1
      error_message = "Expected exactly one account-scoped Pages Write permission group, but Cloudflare returned ${length(local.pages_write_permission_groups)} matches. Verify the bootstrap token, account ID, and permission-group list response."
    }
  }
}

resource "github_actions_environment_secret" "cloudflare_api_token" {
  for_each = local.github_deployment_environments

  repository  = var.github_repository_name
  environment = each.value
  secret_name = "CLOUDFLARE_API_TOKEN"
  value       = cloudflare_account_token.github_actions_pages.value
}
