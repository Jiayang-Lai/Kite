#!/usr/bin/env bash
# Runs once each time the dev container is created. Large downloads are cached outside the
# container: Chromium's system libraries in an image layer (see Dockerfile), and Playwright
# browsers, npm packages, and NuGet packages in named volumes (see devcontainer.json), so a
# rebuild only fetches what changed.
set -euo pipefail

# Named volumes are created root-owned when they did not exist before this image; fix the mount
# points only (not recursively) so this stays fast once the caches are large.
sudo chown -R vscode /home/vscode/.claude
sudo chown vscode:vscode /home/vscode/.cache/ms-playwright /home/vscode/.npm /home/vscode/.nuget/packages

npm install -g npm@11.14.1
git submodule update --init --recursive
dotnet restore vendor/kql-to-sql/KqlToSql.slnx
npm ci

# Downloads Chromium only when this Playwright version's build is not already in the volume.
npx playwright install chromium

# The Dockerfile pins Chromium's system libraries; flag any that a newer Playwright needs.
if ! npx playwright install-deps --dry-run chromium | grep -q 'All system dependencies are installed'; then
	echo 'Warning: Playwright needs system packages that the dev container image lacks.' >&2
	echo 'Add them to .devcontainer/Dockerfile from: npx playwright install-deps --dry-run chromium' >&2
fi
