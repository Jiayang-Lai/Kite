resource "cloudflare_pages_project" "kite" {
  account_id        = var.cloudflare_account_id
  name              = var.pages_project_name
  production_branch = var.pages_production_branch

  lifecycle {
    prevent_destroy = true
  }
}

# Adopt the existing direct-upload Pages project on the first apply.
import {
  to = cloudflare_pages_project.kite
  id = "${var.cloudflare_account_id}/${var.pages_project_name}"
}

resource "cloudflare_pages_domain" "kite" {
  account_id   = var.cloudflare_account_id
  project_name = cloudflare_pages_project.kite.name
  name         = var.pages_custom_domain

  lifecycle {
    prevent_destroy = true
  }
}

# Adopt the existing custom-domain attachment. DNS remains outside this root.
import {
  to = cloudflare_pages_domain.kite
  id = "${var.cloudflare_account_id}/${var.pages_project_name}/${var.pages_custom_domain}"
}
