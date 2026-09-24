# syntax=docker/dockerfile:1
# ═══════════════════════════════════════════════════════════════
#   ops-api and the traffic lab (D-097): one small image, two commands
#   (node api/server.mjs, node lab/server.mjs). Built, scanned and signed by
#   the release job like the application, and published as a tag of the same
#   package, so the cluster's signature policy covers it too (D-060).
# ═══════════════════════════════════════════════════════════════
# The Node image the application is built on, and the k6 the load tests ran
# (scripts/load-run.mjs), both by digest.
ARG NODE_IMAGE=node:24.21.0-alpine3.24@sha256:be80f76cf40ec8e42b9bec49f60a55e0660f30af58d3e5a25530785b30ea67e2
ARG K6_IMAGE=grafana/k6:2.2.0@sha256:9bd01d6941fca969cb61bb57d2da5ee9b385fe2aa8881df3798c196564d6ace6

FROM ${K6_IMAGE} AS k6

FROM ${NODE_IMAGE} AS deps
WORKDIR /ops
COPY package.json package-lock.json ./
# Exactly the locked versions, and only what runs.
RUN npm ci --omit=dev --no-audit --no-fund --ignore-scripts

FROM ${NODE_IMAGE} AS runner
ARG GIT_SHA=unknown
ARG APP_VERSION=dev
ARG BUILD_DATE=unknown
LABEL org.opencontainers.image.title="splitx-ops" \
      org.opencontainers.image.description="ops-api and the traffic lab for SplitX's /ops page" \
      org.opencontainers.image.source="https://github.com/Sayandip-Jana-1018/SplitX" \
      org.opencontainers.image.revision="${GIT_SHA}" \
      org.opencontainers.image.version="${APP_VERSION}" \
      org.opencontainers.image.created="${BUILD_DATE}"
WORKDIR /ops
ENV NODE_ENV=production
COPY --from=k6 /usr/bin/k6 /usr/local/bin/k6
COPY --from=deps /ops/node_modules ./node_modules
COPY package.json ./
COPY lib ./lib
COPY api ./api
COPY lab ./lab
# The base image's unprivileged node user.
USER 1000:1000
EXPOSE 8080
CMD ["node", "api/server.mjs"]
