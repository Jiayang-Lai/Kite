# Self-hosting Kite

Kite is a static web application served by an unprivileged nginx process in its published container. The image includes the KQL translator and local DuckDB-WASM assets needed for browser-emulated queries.

## Run the published image

Tagged releases are published to GitHub Container Registry. Pin a version tag when you need reproducible deployments.

With Docker:

```bash
docker pull ghcr.io/jiayang-lai/kite:latest
docker run --rm -p 3000:8080 ghcr.io/jiayang-lai/kite:latest
```

With Podman:

```bash
podman pull ghcr.io/jiayang-lai/kite:latest
podman run --rm -p 3000:8080 ghcr.io/jiayang-lai/kite:latest
```

Open <http://localhost:3000>. The container listens on port `8080`; mapping it to host port `3000` leaves `localhost:8080` available for Kite's built-in local Kustainer connection. Use `/healthz` for container health checks.

## Verify the published image

Release images are signed with Cosign by the tag-triggered GitHub Actions release workflow. Verify a versioned image against that workflow's keyless signing identity before running it:

```bash
release_tag=v0.0.10
cosign verify \
  --certificate-identity "https://github.com/Jiayang-Lai/Kite/.github/workflows/release.yml@refs/tags/$release_tag" \
  --certificate-oidc-issuer "https://token.actions.githubusercontent.com" \
  "ghcr.io/jiayang-lai/kite:$release_tag"
```

For a reproducible deployment, copy the `sha256:...` digest reported by verification and pull or run `ghcr.io/jiayang-lai/kite@sha256:...`. The `latest` tag points to a signed digest but remains mutable, so it is unsuitable as a permanent deployment pin.

## Build the image from source

The container build compiles the vendored KQL translator WASM and the container-targeted Kite frontend. Initialize the translator submodule before building; Node.js and .NET are not required on the host.

```bash
git clone https://github.com/Jiayang-Lai/Kite.git
cd Kite
git submodule update --init --recursive
docker build -t kite:local .
docker run --rm -p 3000:8080 kite:local
```

For rootless Podman:

```bash
podman build --format docker -t kite:local .
podman run --rm -p 3000:8080 kite:local
```

The Docker image format preserves the Dockerfile health check; Podman's default OCI image format does not support that metadata.

The build performs no Git operations, but it downloads application dependencies and any Kusto documentation missing from `static/kusto-docs`. A clean build therefore requires network access. The final image contains only the generated static application and nginx server.

## Connect to local Kustainer

Kite includes a **Local Kusto** connection for `http://localhost:8080`. Start a [Kustainer](https://learn.microsoft.com/en-us/azure/data-explorer/kusto-emulator-install) instance on that address, then select **Local Kusto** in Kite to run queries and management commands.

For mounted-file ingestion, mount a volume at `/kustodata/raw`:

```yaml
services:
  kusto:
    image: mcr.microsoft.com/azuredataexplorer/kustainer-linux
    ports:
      - '127.0.0.1:8080:8080'
    volumes:
      - kustodata:/kustodata
    environment:
      - ACCEPT_EULA=Y
    restart: always
```

The Kusto endpoint must allow requests from Kite's browser origin through CORS. Kustainer does not provide authentication or an encrypted connection, so keep it bound to the local machine.

Kite currently supports Kustainer only when it is reachable from the user's browser on the local machine. Hosted Azure Data Explorer and other remote Kusto clusters are not yet supported.

For a larger Docker-based Kusto lab, see [100 Days of KQL](https://github.com/Jiayang-Lai/100-Days-of-KQL).
