resource "github_repository" "kite" {
  name       = var.repository_name
  visibility = "public"

  has_issues      = true
  has_projects    = true
  has_wiki        = true
  has_discussions = false
  is_template     = false

  allow_merge_commit  = false
  allow_squash_merge  = true
  allow_rebase_merge  = false
  allow_auto_merge    = true
  allow_update_branch = true

  squash_merge_commit_title   = "PR_TITLE"
  squash_merge_commit_message = "PR_BODY"
  delete_branch_on_merge      = true

  archive_on_destroy = true

  lifecycle {
    prevent_destroy = true
  }
}

# Adopt the existing repository on the first apply rather than attempting to
# recreate it. Keeping this block is harmless after the import is recorded.
import {
  to = github_repository.kite
  id = var.repository_name
}

resource "github_branch_default" "main" {
  repository = github_repository.kite.name
  branch     = "main"
}
