variable "github_owner" {
  description = "GitHub user or organisation that owns the repository."
  type        = string
  default     = "Jiayang-Lai"
}

variable "repository_name" {
  description = "Name of the GitHub repository."
  type        = string
  default     = "Kite"
}

variable "cloudflare_account_id" {
  description = "Cloudflare account identifier. This is configuration, not a credential."
  type        = string
  nullable    = false

  validation {
    condition     = length(trimspace(var.cloudflare_account_id)) > 0
    error_message = "cloudflare_account_id must not be empty."
  }
}

variable "cloudflare_pages_project_name" {
  description = "Cloudflare Pages project used by all deployment environments."
  type        = string
  nullable    = false

  validation {
    condition     = length(trimspace(var.cloudflare_pages_project_name)) > 0
    error_message = "cloudflare_pages_project_name must not be empty."
  }
}

variable "cloudflare_pages_production_branch" {
  description = "Branch configured as the production branch in the Cloudflare Pages project."
  type        = string
  nullable    = false

  validation {
    condition     = length(trimspace(var.cloudflare_pages_production_branch)) > 0
    error_message = "cloudflare_pages_production_branch must not be empty."
  }
}

variable "required_approving_review_count" {
  description = "Approving reviews required before a pull request can merge to main. Use zero for a solo repository."
  type        = number
  default     = 0

  validation {
    condition = (
      var.required_approving_review_count >= 0 &&
      var.required_approving_review_count <= 6 &&
      floor(var.required_approving_review_count) == var.required_approving_review_count
    )
    error_message = "required_approving_review_count must be a whole number from 0 to 6."
  }
}

variable "require_last_push_approval" {
  description = "Require the latest pull-request push to be approved by somebody other than its author. Enable for a team repository."
  type        = bool
  default     = false
}

variable "allow_admin_pull_request_bypass" {
  description = "Allow repository administrators to bypass pull-request rules, but not force-push or deletion rules."
  type        = bool
  default     = false
}

variable "production_reviewer_user_ids" {
  description = "Numeric GitHub user IDs permitted to approve production deployments. At least one reviewer is required."
  type        = set(number)
  default     = [32904024]

  validation {
    condition = (
      length(var.production_reviewer_user_ids) >= 1 &&
      length(var.production_reviewer_user_ids) <= 6
    )
    error_message = "production_reviewer_user_ids must contain between one and six GitHub user IDs."
  }
}

variable "production_prevent_self_review" {
  description = "Prevent the deployment initiator from approving production. Leave false for a solo repository."
  type        = bool
  default     = false
}
