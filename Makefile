.PHONY: help scan sbom vuln version-bump ff-merge

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
