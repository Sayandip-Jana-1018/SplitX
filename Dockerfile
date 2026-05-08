# ═══════════════════════════════════════════════════════════════
#   SplitX — Production Dockerfile (Multi-Stage)
#   Optimized for: Security, Caching, Kubernetes Health Checks
# ═══════════════════════════════════════════════════════════════

# ── Stage 1: Install dependencies ──
FROM node:20-alpine3.19 AS deps
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# ── Stage 2: Build the application ──
FROM node:20-alpine3.19 AS builder
WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN npx prisma generate && npm run build

# ── Stage 3: Production runtime ──
FROM node:20-alpine3.19 AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000

# Build-time metadata labels
LABEL org.opencontainers.image.title="SplitX"
LABEL org.opencontainers.image.description="Production-grade expense splitting application"
LABEL org.opencontainers.image.source="https://github.com/Sayandip-Jana-1018/SplitX"

# Security: run as non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000

# Kubernetes liveness/readiness probe target
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=5 \
  CMD ["wget", "--no-verbose", "--tries=1", "--spider", "http://127.0.0.1:3000/api/health"]

CMD ["node", "server.js"]
