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

resource "github_repository_ruleset" "protect_release_tags" {
  name        = "Protect release tags"
  repository  = github_repository.kite.name
  target      = "tag"
  enforcement = "active"

  bypass_actors {
    actor_id    = 5
    actor_type  = "RepositoryRole"
    bypass_mode = "always"
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
