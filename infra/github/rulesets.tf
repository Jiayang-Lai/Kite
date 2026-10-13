resource "github_repository_ruleset" "protect_main" {
  name        = "Protect main"
  repository  = github_repository.kite.name
  target      = "branch"
  enforcement = "active"

  dynamic "bypass_actors" {
    for_each = var.allow_admin_pull_request_bypass ? [1] : []

    content {
      actor_id    = 5
      actor_type  = "RepositoryRole"
      bypass_mode = "pull_request"
    }
  }

  conditions {
    ref_name {
      include = ["~DEFAULT_BRANCH"]
      exclude = []
    }
  }

  rules {
    deletion                = true
    non_fast_forward        = true
    required_linear_history = true

    pull_request {
      allowed_merge_methods             = ["squash"]
      dismiss_stale_reviews_on_push     = var.required_approving_review_count > 0
      require_last_push_approval        = var.require_last_push_approval
      required_approving_review_count   = var.required_approving_review_count
      required_review_thread_resolution = true
    }

    required_status_checks {
      strict_required_status_checks_policy = true

      required_check {
        context = "Validate"
      }

      required_check {
        context = "Validate container image"
      }
    }
  }
}

# The release-tag App is registered from infra/github/release-tag-app.json by
# scripts/create-release-tag-app.mjs, which records its ID in terraform.tfvars.
locals {
  release_tag_app_id = var.release_tag_app_id
}

resource "github_repository_ruleset" "protect_release_tags" {
  name        = "Protect release tags"
  repository  = github_repository.kite.name
  target      = "tag"
  enforcement = "active"

  # The Create release tag workflow authenticates as this GitHub App, making it the only way to
  # create v* tags once release_tag_app_id is set.
  dynamic "bypass_actors" {
    for_each = local.release_tag_app_id == null ? [] : [local.release_tag_app_id]

    content {
      actor_id    = bypass_actors.value
      actor_type  = "Integration"
      bypass_mode = "always"
    }
  }

  # Administrators keep tag access until the App is configured, and afterwards only as an
  # explicit break-glass setting.
  dynamic "bypass_actors" {
    for_each = local.release_tag_app_id == null || var.allow_admin_release_tag_bypass ? [1] : []

    content {
      actor_id    = 5
      actor_type  = "RepositoryRole"
      bypass_mode = "always"
    }
  }

  conditions {
    ref_name {
      include = ["refs/tags/v*"]
      exclude = []
    }
  }

  rules {
    creation         = true
    deletion         = true
    non_fast_forward = true
    update           = true
  }
}
