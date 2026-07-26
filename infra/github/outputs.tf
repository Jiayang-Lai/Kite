output "repository_url" {
  description = "Managed GitHub repository URL."
  value       = github_repository.kite.html_url
}

output "environment_names" {
  description = "GitHub deployment environments managed by this configuration."
  value = sort(concat(
    tolist(local.deployment_environments),
    [github_repository_environment.production.environment],
  ))
}

output "cloudflare_token_environments" {
  description = "Environments that receive CLOUDFLARE_API_TOKEN from the Cloudflare Terraform root."
  value = [
    "preview",
    "integration-uat",
    "release-candidate",
    "production",
  ]
}
