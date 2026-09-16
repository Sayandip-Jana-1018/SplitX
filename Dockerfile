# ═══════════════════════════════════════════════════════════════
#   SplitX — production image
#
#   Measured against a deliberately naive build in
#   docs/evidence/image-comparison.md; every choice below is
#   explained in docs/DECISIONS.md (phase 2).
#
#   Build with provenance:  npm run image:build
#   (docker buildx bake app, with GIT_SHA / APP_VERSION / BUILD_DATE)
# ═══════════════════════════════════════════════════════════════

# Base images are pinned by digest, so a rebuild can't silently pick up a
# different base. Node 24 is the active LTS line (Node 20 reached end of life).
ARG NODE_IMAGE=node:24.21.0-alpine3.24@sha256:be80f76cf40ec8e42b9bec49f60a55e0660f30af58d3e5a25530785b30ea67e2
ARG RUNTIME_IMAGE=alpine:3.24.1@sha256:28bd5fe8b56d1bd048e5babf5b10710ebe0bae67db86916198a6eec434943f8b

# ── Stage 1: dependencies — rebuilt only when the lockfile or schema changes ──
FROM ${NODE_IMAGE} AS deps
WORKDIR /app

COPY package.json package-lock.json ./
# postinstall runs `prisma generate`, which needs the schema
COPY prisma ./prisma
# The npm download cache survives between builds, so a lockfile change
# re-downloads only the packages that changed.
RUN --mount=type=cache,target=/root/.npm \
    npm ci --no-audit --no-fund

# ── Stage 2: build ──
FROM ${NODE_IMAGE} AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# The standalone trace copies some packages the server never loads. Measured
# in the image and removed here (docs/DECISIONS.md, D-029):
#   typescript                   19 MB  compiled next.config.ts at build time only
#   @img/sharp-*-linux-x64       16 MB  glibc builds; this image is musl (the linuxmusl builds stay)
#   @prisma/client/runtime/*wasm 50 MB  WebAssembly engines for edge runtimes and other databases;
#                                       the generated client loads runtime/library.js and the native engine
#   .prisma/client/*.wasm         2 MB  the same engine for the edge client
RUN cd .next/standalone/node_modules \
    && rm -rf typescript \
              @img/sharp-libvips-linux-x64 @img/sharp-linux-x64 \
              @prisma/client/runtime/*.wasm-base64.js @prisma/client/runtime/*.wasm-base64.mjs \
              .prisma/client/*.wasm

# ── Stage 3: runtime — Alpine plus the Node binary, nothing else ──
FROM ${NODE_IMAGE} AS node
FROM ${RUNTIME_IMAGE} AS runner
WORKDIR /app

# Only the node binary is copied: no npm, npx, yarn or corepack, which a running
# server never uses and which carry most of the base image's CVEs.
# Node needs the C++ runtime; OpenSSL 3 and CA certificates are already in Alpine.
# The digest above fixes what this image starts from; the upgrade below is what
# keeps OpenSSL and the rest patched between Alpine releases (Trivy gates on it).
RUN apk upgrade --no-cache \
    && apk add --no-cache libstdc++ \
    && addgroup -S -g 1001 nodejs \
    && adduser -S -u 1001 -G nodejs -H -h /app nextjs
COPY --from=node /usr/local/bin/node /usr/local/bin/node

# Application files belong to root and are read-only to the app user: code that
# is compromised at runtime can't rewrite the server. Only Next's cache
# (optimized images) is writable — mount an emptyDir there when the root
# filesystem is read-only in Kubernetes.
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
RUN mkdir -p .next/cache && chown nextjs:nodejs .next/cache

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    # Next binds to $HOSTNAME. Kubernetes sets it to the pod name, which would
    # bind only the pod IP and break probes and port-forwarding on localhost.
    HOSTNAME=0.0.0.0

# Provenance last, so changing it never invalidates the layers above.
# The same values reach Prometheus as splitx_app_info{version, git_sha}.
ARG GIT_SHA=unknown
ARG APP_VERSION=dev
ARG BUILD_DATE=unknown
ENV GIT_SHA=${GIT_SHA} \
    APP_VERSION=${APP_VERSION}
LABEL org.opencontainers.image.title="SplitX" \
      org.opencontainers.image.description="Expense splitting with the fewest settle-up payments" \
      org.opencontainers.image.source="https://github.com/Sayandip-Jana-1018/SplitX" \
      org.opencontainers.image.revision="${GIT_SHA}" \
      org.opencontainers.image.version="${APP_VERSION}" \
      org.opencontainers.image.created="${BUILD_DATE}" \
      org.opencontainers.image.base.name="alpine:3.24.1"

USER nextjs
EXPOSE 3000

# Liveness only — the database is checked by readiness, not by the container health.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=5 \
  CMD ["wget", "--no-verbose", "--tries=1", "--spider", "http://127.0.0.1:3000/api/health/live"]

# No init process: Next.js handles SIGTERM itself (stops accepting, finishes
# in-flight requests) and the server starts no child processes (D-030).
CMD ["node", "server.js"]
