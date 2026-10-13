# Pinned to an Ubuntu release so the Playwright package list below stays valid. When changing the
# release, regenerate the list from `npx playwright install-deps --dry-run chromium` on that OS.
FROM mcr.microsoft.com/devcontainers/base:3-ubuntu26.04

# System libraries for Playwright's Chromium (its `tools` and `chromium` dependencies for Ubuntu
# 26.04, identical on x64 and arm64). Installing them in an image layer lets rebuilds reuse them
# instead of running `playwright install --with-deps` against apt on every container creation.
RUN apt-get update \
	&& DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
		fonts-freefont-ttf \
		fonts-ipafont-gothic \
		fonts-liberation \
		fonts-noto-color-emoji \
		fonts-tlwg-loma-otf \
		fonts-unifont \
		fonts-wqy-zenhei \
		libasound2t64 \
		libatk-bridge2.0-0t64 \
		libatk1.0-0t64 \
		libatspi2.0-0t64 \
		libcairo2 \
		libcups2t64 \
		libdbus-1-3 \
		libdrm2 \
		libfontconfig1 \
		libfreetype6 \
		libgbm1 \
		libglib2.0-0t64 \
		libnspr4 \
		libnss3 \
		libpango-1.0-0 \
		libx11-6 \
		libxcb1 \
		libxcomposite1 \
		libxdamage1 \
		libxext6 \
		libxfixes3 \
		libxkbcommon0 \
		libxrandr2 \
		xfonts-cyrillic \
		xfonts-scalable \
		xvfb \
	&& rm -rf /var/lib/apt/lists/*

# Anchore tools used by `make sbom` (syft) and `make scan` (grype).
RUN curl -sSfL https://raw.githubusercontent.com/anchore/syft/main/install.sh | sh -s -- -b /usr/local/bin \
	&& curl -sSfL https://raw.githubusercontent.com/anchore/grype/main/install.sh | sh -s -- -b /usr/local/bin

# Mount points for the download caches that devcontainer.json keeps in named volumes. Docker copies
# a mount point's ownership into a new, empty volume, so creating them here gives vscode ownership.
RUN install -d -o vscode -g vscode \
	/home/vscode/.cache \
	/home/vscode/.cache/ms-playwright \
	/home/vscode/.npm \
	/home/vscode/.nuget \
	/home/vscode/.nuget/packages
