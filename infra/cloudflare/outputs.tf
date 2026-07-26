output "pages_project" {
  description = "Managed Cloudflare Pages project."
  value = {
    name              = cloudflare_pages_project.kite.name
    production_branch = cloudflare_pages_project.kite.production_branch
    subdomain         = cloudflare_pages_project.kite.subdomain
    custom_domain     = cloudflare_pages_domain.kite.name
  }
}

output "deployment_token_id" {
  description = "Identifier of the generated account-owned deployment token."
  value       = cloudflare_account_token.github_actions_pages.id
}

output "deployment_api_token" {
  description = "Generated Pages deployment token. Normally consumed through the managed GitHub environment secrets."
  value       = cloudflare_account_token.github_actions_pages.value
  sensitive   = true
}
