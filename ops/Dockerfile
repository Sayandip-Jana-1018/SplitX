# syntax=docker/dockerfile:1
# ═══════════════════════════════════════════════════════════════
#   ops-api and the traffic lab (D-097): one small image, two commands
#   (node api/server.mjs, node lab/server.mjs). Built, scanned and signed by
#   the release job like the application, and published as a tag of the same
#   package, so the cluster's signature policy covers it too (D-060).
# ═══════════════════════════════════════════════════════════════
# The same Node and Alpine the application's image is built from (Dockerfile,
# checked by tests/unit/infra/opsApi.test.ts), and k6 2.3.0, whose Go 1.27.1
# and modules pass the release scan (2.2.0's did not), all by digest.
ARG NODE_IMAGE=node:24.21.0-alpine3.24@sha256:be80f76cf40ec8e42b9bec49f60a55e0660f30af58d3e5a25530785b30ea67e2
ARG RUNTIME_IMAGE=alpine:3.24.1@sha256:28bd5fe8b56d1bd048e5babf5b10710ebe0bae67db86916198a6eec434943f8b
ARG K6_IMAGE=grafana/k6:2.3.0@sha256:9c2dee7f8ed74d317e4027c06a10f169b625638189de8d4555d0b3486a5aeb34

FROM ${K6_IMAGE} AS k6

FROM ${NODE_IMAGE} AS deps
WORKDIR /ops
COPY package.json package-lock.json ./
# Exactly the locked versions, and only what runs.
RUN npm ci --omit=dev --no-audit --no-fund --ignore-scripts

FROM ${NODE_IMAGE} AS node

FROM ${RUNTIME_IMAGE} AS runner
ARG GIT_SHA=unknown
ARG APP_VERSION=dev
ARG BUILD_DATE=unknown
LABEL org.opencontainers.image.title="splitx-ops" \
      org.opencontainers.image.description="ops-api and the traffic lab for SplitX's /ops page" \
      org.opencontainers.image.source="https://github.com/Sayandip-Jana-1018/SplitX" \
      org.opencontainers.image.revision="${GIT_SHA}" \
      org.opencontainers.image.version="${APP_VERSION}" \
      org.opencontainers.image.created="${BUILD_DATE}" \
      org.opencontainers.image.base.name="alpine:3.24.1"
WORKDIR /ops
# As in the application's image: Alpine with its security fixes applied, and
# only the node binary, without npm, whose own dependencies are most of the
# Node image's CVEs. Node needs the C++ runtime; OpenSSL and CA certificates
# come with Alpine.
RUN apk upgrade --no-cache \
    && apk add --no-cache libstdc++
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=k6 /usr/bin/k6 /usr/local/bin/k6
COPY --from=deps /ops/node_modules ./node_modules
COPY package.json ./
COPY lib ./lib
COPY api ./api
COPY lab ./lab
ENV NODE_ENV=production
# Unprivileged; Kubernetes runs it as the same user (k8s/ops, runAsUser 1000).
USER 1000:1000
EXPOSE 8080
CMD ["node", "api/server.mjs"]
