# syntax=docker/dockerfile:1.7

FROM mcr.microsoft.com/dotnet/sdk:10.0-alpine3.23 AS build

RUN apk add --no-cache nodejs npm \
	&& npm install --global npm@11.14.1 \
	&& apk del npm

WORKDIR /src

COPY package.json package-lock.json .npmrc ./
RUN --mount=type=cache,target=/root/.npm \
	npm ci --ignore-scripts

COPY . .

RUN npm run prepare
RUN dotnet workload restore vendor/kql-to-sql/src/KqlWasmBridge/KqlWasmBridge.csproj
RUN --mount=type=cache,target=/root/.nuget/packages \
	npm run build:kql-wasm
RUN npm run build:container

FROM docker.io/nginxinc/nginx-unprivileged:1.31-alpine3.24-slim AS runtime

ARG KITE_VERSION=dev
ARG VCS_REF=unknown
ARG BUILD_DATE=unknown

LABEL org.opencontainers.image.title="Kite" \
	org.opencontainers.image.description="Local-first Kusto workspace" \
	org.opencontainers.image.source="https://github.com/Jiayang-Lai/Kite" \
	org.opencontainers.image.licenses="MIT" \
	org.opencontainers.image.version="$KITE_VERSION" \
	org.opencontainers.image.revision="$VCS_REF" \
	org.opencontainers.image.created="$BUILD_DATE"

COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /src/build/ /usr/share/nginx/html/

USER 101
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
	CMD ["wget", "--quiet", "--output-document=/dev/null", "http://127.0.0.1:8080/healthz"]
