variable "resource_group_name" {
  description = "Name of the resource group created for Kite's Log Analytics workspace."
  type        = string
  nullable    = false

  validation {
    condition     = length(trimspace(var.resource_group_name)) > 0
    error_message = "resource_group_name must not be empty."
  }
}

variable "location" {
  description = "Azure region for the resource group and Log Analytics workspace."
  type        = string
  nullable    = false

  validation {
    condition     = length(trimspace(var.location)) > 0
    error_message = "location must not be empty."
  }
}

variable "workspace_name" {
  description = "Name of the Log Analytics workspace."
  type        = string
  nullable    = false

  validation {
    condition     = can(regex("^[A-Za-z0-9](?:[A-Za-z0-9-]{2,61}[A-Za-z0-9])$", var.workspace_name))
    error_message = "workspace_name must be 4-63 letters, digits, or hyphens and cannot start or end with a hyphen."
  }
}

variable "secondary_workspace_name" {
  description = "Name of the second Log Analytics workspace used to test editing and switching Kite clusters."
  type        = string
  nullable    = false

  validation {
    condition     = can(regex("^[A-Za-z0-9](?:[A-Za-z0-9-]{2,61}[A-Za-z0-9])$", var.secondary_workspace_name))
    error_message = "secondary_workspace_name must be 4-63 letters, digits, or hyphens and cannot start or end with a hyphen."
  }

  validation {
    condition     = var.secondary_workspace_name != var.workspace_name
    error_message = "secondary_workspace_name must differ from workspace_name."
  }
}

variable "application_display_name" {
  description = "Display name for Kite's Microsoft Entra SPA application registration."
  type        = string
  default     = "Kite Log Analytics"
  nullable    = false
}

variable "spa_redirect_uris" {
  description = "Kite browser origins registered as Microsoft Entra SPA redirect URIs. A trailing slash is optional; Terraform registers both the root URL and the /auth/callback URL for each origin."
  type        = set(string)
  nullable    = false

  validation {
    condition = length(var.spa_redirect_uris) > 0 && alltrue([
      for uri in var.spa_redirect_uris : can(regex(
        "^(?:https://[^/?#]+|http://(?:localhost|127\\.0\\.0\\.1|\\[::1\\])(?::[0-9]{1,5})?)/?$",
        uri
      ))
    ])
    error_message = "spa_redirect_uris must contain origin-only HTTPS URLs, or HTTP local-development URLs such as http://localhost:5173, http://127.0.0.1:5173, or http://[::1]:5173."
  }
}

variable "application_owner_object_ids" {
  description = "Additional Entra user or service-principal object IDs that own the app registration."
  type        = set(string)
  default     = []
  nullable    = false
}

variable "workspace_log_reader_principal_ids" {
  description = "Entra object IDs to grant Log Analytics Reader on the workspace. For browser-only Kite, use users or groups containing users."
  type        = set(string)
  default     = []
  nullable    = false
}

variable "test_log_ingestor_principal_ids" {
  description = "Entra service principal or managed-identity object IDs allowed to ingest test records through the Kite test DCR."
  type        = set(string)
  default     = []
  nullable    = false
}

variable "retention_in_days" {
  description = "Workspace data retention in days."
  type        = number
  default     = 30
  nullable    = false

  validation {
    condition     = var.retention_in_days >= 30 && var.retention_in_days <= 730
    error_message = "retention_in_days must be between 30 and 730."
  }
}

variable "daily_quota_gb" {
  description = "Optional daily ingestion cap in GB. Leave null for no Terraform-managed cap."
  type        = number
  default     = null
  nullable    = true
}

variable "internet_ingestion_enabled" {
  description = "Whether public ingestion endpoints are enabled for the workspace."
  type        = bool
  default     = true
  nullable    = false
}

variable "internet_query_enabled" {
  description = "Whether public query endpoints are enabled. This must remain true for browser-direct Kite queries."
  type        = bool
  default     = true
  nullable    = false
}

variable "tags" {
  description = "Tags applied to the resource group and Log Analytics workspace."
  type        = map(string)
  default = {
    managed-by = "terraform"
    project    = "kite"
  }
  nullable = false
}
