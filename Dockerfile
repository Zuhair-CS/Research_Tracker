# ---------------------------------------------------------------------------
# PB-1 Publication Tracker - Hardened Multi-Stage Production Dockerfile
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS builder

WORKDIR /app

# Install dependencies using pinned lockfile and .npmrc rules
COPY package.json package-lock.json .npmrc ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci --include=dev

# Copy source and build API (Prisma generate + tsc) and Web (Vite)
COPY apps/api apps/api
COPY apps/web apps/web
RUN npm run build

# Strip devDependencies so only production packages enter the final image
RUN npm prune --omit=dev

# ---------------------------------------------------------------------------
# Final runtime image (minimal, non-root)
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS runner

# Apply Debian security updates (e.g. libpam CVE-2025-6020) to the runtime image
RUN apt-get update \
    && apt-get upgrade -y --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    WEB_DIST_DIR=/app/apps/web/dist

COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/apps/api/package.json ./apps/api/package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/api/prisma ./apps/api/prisma
COPY --from=builder /app/apps/api/prisma.config.ts ./apps/api/prisma.config.ts
COPY --from=builder /app/apps/web/dist ./apps/web/dist

# Run as unprivileged built-in 'node' user and remove npm/corepack from runtime image
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["node", "-e", "fetch('http://localhost:3000/api/health/ready').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]

CMD ["node", "apps/api/dist/server.js"]
