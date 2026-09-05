.PHONY: help scan sbom vuln version-bump ff-merge tf-init tf-plan tf-apply \
	tf-github-init tf-github-plan tf-github-apply \
	tf-cloudflare-init tf-cloudflare-plan tf-cloudflare-apply \
	tf-azure-init tf-azure-plan tf-azure-apply

TF_ROOT ?= infra/github
TF_ENV_FILE ?= $(TF_ROOT)/.env
TF_CREDENTIALS := GITHUB_TOKEN CLOUDFLARE_API_TOKEN

define run_terraform
	@test -d "$(TF_ROOT)" || { echo "Terraform root not found: $(TF_ROOT)"; exit 1; }; \
	trap 'unset $(TF_CREDENTIALS)' EXIT; \
	if [ -f "$(TF_ENV_FILE)" ]; then \
		set -a; \
		. "$(TF_ENV_FILE)" || exit $$?; \
		set +a; \
	elif [ "$(TF_ROOT)" != "infra/azure" ]; then \
		echo "Terraform environment file not found: $(TF_ENV_FILE)"; \
		exit 1; \
	fi; \
	terraform -chdir="$(TF_ROOT)" $(1)
endef

help: ## Show help message
	@grep -E '^[a-zA-Z0-9_%\-]+:[[:space:]]*##' $(MAKEFILE_LIST) | sed 's/:.*##[[:space:]]*/: /'

sbom: ## Generate Software Bill of Materials (SBOM) using Syft
	@echo "Generating SBOM using Syft..."
	syft scan . -o cyclonedx-json=sbom.json

scan: ## Run grype security scan on the SBOM file (requires sbom.json to be present)
	@echo "Running grype security scan on the SBOM file..."
	grype sbom:sbom.json -v --fail-on high

vuln: sbom scan ## Generate SBOM and run vulnerability scan

version-bump: ## Bump version using npm (patch by default)
	@echo "Bumping version..."
	npm version patch --no-git-tag-version

ff-merge: ## Fast-forward merge the dev branch to main
	@echo "Performing fast-forward merge to main..."
	git checkout main
	git merge --ff-only dev

tf-init: ## Initialize a Terraform root with credentials from its .env file
	$(call run_terraform,init)

tf-plan: ## Plan a Terraform root with credentials from its .env file
	$(call run_terraform,plan)

tf-apply: ## Apply a Terraform root with credentials from its .env file
	$(call run_terraform,apply)

tf-github-init: ## Initialize the GitHub Terraform root
	@$(MAKE) --no-print-directory tf-init TF_ROOT=infra/github TF_ENV_FILE=infra/github/.env

tf-github-plan: ## Plan the GitHub Terraform root
	@$(MAKE) --no-print-directory tf-plan TF_ROOT=infra/github TF_ENV_FILE=infra/github/.env

tf-github-apply: ## Apply the GitHub Terraform root
	@$(MAKE) --no-print-directory tf-apply TF_ROOT=infra/github TF_ENV_FILE=infra/github/.env

tf-cloudflare-init: ## Initialize the Cloudflare Terraform root
	@$(MAKE) --no-print-directory tf-init TF_ROOT=infra/cloudflare TF_ENV_FILE=infra/cloudflare/.env

tf-cloudflare-plan: ## Plan the Cloudflare Terraform root
	@$(MAKE) --no-print-directory tf-plan TF_ROOT=infra/cloudflare TF_ENV_FILE=infra/cloudflare/.env

tf-cloudflare-apply: ## Apply the Cloudflare Terraform root
	@$(MAKE) --no-print-directory tf-apply TF_ROOT=infra/cloudflare TF_ENV_FILE=infra/cloudflare/.env

tf-azure-init: ## Initialize the Azure Terraform root
	@$(MAKE) --no-print-directory tf-init TF_ROOT=infra/azure TF_ENV_FILE=infra/azure/.env

tf-azure-plan: ## Plan the Azure Terraform root
	@$(MAKE) --no-print-directory tf-plan TF_ROOT=infra/azure TF_ENV_FILE=infra/azure/.env

tf-azure-apply: ## Apply the Azure Terraform root
	@$(MAKE) --no-print-directory tf-apply TF_ROOT=infra/azure TF_ENV_FILE=infra/azure/.env
