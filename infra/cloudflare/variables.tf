variable "cloudflare_account_id" {
  description = "Cloudflare account containing the existing Pages project."
  type        = string
  nullable    = false

  validation {
    condition     = can(regex("^[0-9a-f]{32}$", var.cloudflare_account_id))
    error_message = "cloudflare_account_id must be a 32-character hexadecimal account ID."
  }
}

variable "pages_project_name" {
  description = "Name of the existing Cloudflare Pages project."
  type        = string
  default     = "kite"
  nullable    = false

  validation {
    condition     = length(trimspace(var.pages_project_name)) > 0
    error_message = "pages_project_name must not be empty."
  }
}

variable "pages_production_branch" {
  description = "Branch Cloudflare Pages treats as production."
  type        = string
  default     = "main"
  nullable    = false

  validation {
    condition     = length(trimspace(var.pages_production_branch)) > 0
    error_message = "pages_production_branch must not be empty."
  }
}

variable "pages_custom_domain" {
  description = "Existing custom domain attached to the Pages project."
  type        = string
  default     = "kite.humblehamster.com"
  nullable    = false

  validation {
    condition     = length(trimspace(var.pages_custom_domain)) > 0
    error_message = "pages_custom_domain must not be empty."
  }
}

variable "deployment_token_name" {
  description = "Name of the account-owned token used by GitHub Actions to deploy Pages artifacts."
  type        = string
  default     = "kite-github-actions-pages-deploy"
  nullable    = false

  validation {
    condition     = length(trimspace(var.deployment_token_name)) > 0
    error_message = "deployment_token_name must not be empty."
  }
}

variable "deployment_token_expires_on" {
  description = "Optional RFC3339 expiry for the deployment token. Set a date and rotate it regularly when operationally practical."
  type        = string
  default     = null
  nullable    = true

  validation {
    condition = (
      var.deployment_token_expires_on == null ||
      can(formatdate("YYYY-MM-DD'T'hh:mm:ssZ", var.deployment_token_expires_on))
    )
    error_message = "deployment_token_expires_on must be null or a valid RFC3339 timestamp."
  }
}

variable "github_owner" {
  description = "GitHub user or organisation that owns the deployment repository."
  type        = string
  default     = "Jiayang-Lai"
}

variable "github_repository_name" {
  description = "GitHub repository whose environments receive the generated deployment token."
  type        = string
  default     = "Kite"
}
