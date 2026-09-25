# Base pinned by digest for reproducible builds. Tag documents intent;
# digest is authoritative. node:24-alpine as of 2026-07-02 — bump when updating.
FROM node:25-alpine@sha256:bdf2cca6fe3dabd014ea60163eca3f0f7015fbd5c7ee1b0e9ccb4ced6eb02ef4 AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma/
RUN npm ci

FROM node:25-alpine@sha256:bdf2cca6fe3dabd014ea60163eca3f0f7015fbd5c7ee1b0e9ccb4ced6eb02ef4 AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ARG APP_VERSION=dev
ARG GIT_SHA=
ENV NEXT_PUBLIC_APP_VERSION=$APP_VERSION
ENV NEXT_PUBLIC_GIT_SHA=$GIT_SHA
RUN npx prisma generate
RUN npm run build

FROM node:25-alpine@sha256:bdf2cca6fe3dabd014ea60163eca3f0f7015fbd5c7ee1b0e9ccb4ced6eb02ef4 AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Alpine's openssl runtime libs (libcrypto3/libssl3) pick up newly-published HIGH
# CVEs (e.g. CVE-2026-14456, OpenSSL unbounded-memory DoS: 3.5.7-r0 → fixed 3.5.8-r0)
# ahead of a base-image refresh, failing the Trivy gate. Upgrade just those packages
# so the build stays current without waiting on a new node:24-alpine digest.
RUN apk --no-cache upgrade libcrypto3 libssl3

# Strip bundled npm + corepack from the deployed image. Runtime is `node server.js`
# (Next.js standalone) and never invokes npm, but the base image's bundled npm ships
# undici, which picks up newly-published HIGH CVEs (e.g. CVE-2026-12151) and fails the
# Trivy gate. Removing the tooling drops the vuln surface without touching runtime.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
    /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000

# Container-level liveness: hit /api/health with Node's built-in fetch so
# `docker run`/local debugging can detect a hung event loop without an external
# prober. Managed container hosts have their own ingress probe; this is complementary.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
