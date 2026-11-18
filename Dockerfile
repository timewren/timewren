# syntax=docker/dockerfile:1.7
# Dockerfile for TimeWren / TimeTrack production and self-hosting
# Optimized for Next.js 16 with Turbopack

FROM node:22-alpine AS base

# Install dependencies only when needed (full deps for building)
FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY package.json package-lock.json* ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --legacy-peer-deps --prefer-offline --no-audit --no-fund

# Production-only deps for the runtime image (smaller → faster layer push)
FROM base AS deps-prod
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY package.json package-lock.json* ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --legacy-peer-deps --prefer-offline --no-audit --no-fund --omit=dev

# Rebuild the source code only when needed
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Accept build arguments for NEXT_PUBLIC_* variables
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_MARKETING_URL
ARG NEXT_PUBLIC_BRAND
ARG NEXT_PUBLIC_DESKTOP_RELEASES_REPO
ARG NEXT_PUBLIC_REALTIME_ENABLED
ARG NEXT_PUBLIC_UMAMI_SCRIPT_URL
ARG NEXT_PUBLIC_UMAMI_COLLECT_URL
ARG NEXT_PUBLIC_UMAMI_WEBSITE_ID
ARG NEXT_PUBLIC_PLAUSIBLE_SCRIPT_URL
ARG NEXT_PUBLIC_SENTRY_DSN
ARG NEXT_PUBLIC_SENTRY_BROWSER_ENABLED
# Git-SHA fra CI, så åbne faner kan opdage et nyt deploy (/api/version). Læses
# ved kørsel (src/lib/pwa/version.ts), ikke som NEXT_PUBLIC_*-define: en define,
# der skifter ved hvert commit, ugyldiggør Turbopacks build-cache. Her bruges
# den kun af de statisk prerenderede sider. Tom = Next' BUILD_ID bruges.
ARG APP_VERSION
# Enabled only by CI, where the separate typecheck remains a deploy gate.
ARG CI_SKIP_TYPECHECK=false
ARG BETTER_AUTH_SECRET
ARG DATABASE_URL

# Set environment variables for production build
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
# APP_URL, MARKETING_URL and BRAND are read at RUNTIME (src/lib/runtime-env.ts,
# #1017): the args above are optional. Build without them for an image that
# takes the values from the container env; values given here stay as defaults
# (and as the build-time fallback) so existing builds behave as before.
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
ENV NEXT_PUBLIC_MARKETING_URL=$NEXT_PUBLIC_MARKETING_URL
ENV NEXT_PUBLIC_BRAND=$NEXT_PUBLIC_BRAND
ENV NEXT_PUBLIC_DESKTOP_RELEASES_REPO=$NEXT_PUBLIC_DESKTOP_RELEASES_REPO
# NEXT_PUBLIC_* is inlined into the client bundle at build time, so the realtime
# client flag must be baked here (Dokploy runtime env can't reach the client).
ENV NEXT_PUBLIC_REALTIME_ENABLED=$NEXT_PUBLIC_REALTIME_ENABLED
# Plausible-script (tom = ingen analyse). Bages ind ved build.
ENV NEXT_PUBLIC_UMAMI_COLLECT_URL=$NEXT_PUBLIC_UMAMI_COLLECT_URL
ENV NEXT_PUBLIC_UMAMI_SCRIPT_URL=$NEXT_PUBLIC_UMAMI_SCRIPT_URL
ENV NEXT_PUBLIC_UMAMI_WEBSITE_ID=$NEXT_PUBLIC_UMAMI_WEBSITE_ID
ENV NEXT_PUBLIC_PLAUSIBLE_SCRIPT_URL=$NEXT_PUBLIC_PLAUSIBLE_SCRIPT_URL
ENV BETTER_AUTH_SECRET=$BETTER_AUTH_SECRET
ENV DATABASE_URL=$DATABASE_URL

# Increase Node.js memory limit for build
ENV NODE_OPTIONS="--max-old-space-size=6144"

# Disable Sentry upload for faster/safer CI builds
ENV SENTRY_DISABLED=1

# Mount Next.js build cache. Next 16 keeps Turbopack's persistent build cache
# in .next/cache/turbopack (experimental.turbopackFileSystemCacheForBuild
# defaults to true), so a warm builder reuses compiled modules. The du lines
# show in the build log whether the mount survived since the previous build.
# Browser-Sentry (src/instrumentation-client.ts) læser NEXT_PUBLIC_SENTRY_DSN
# fra klientbundtet, så den bages ind her (build-arg). NEXT_PUBLIC_* inlines
# også i serverkoden, så en TOM værdi må ikke nå buildet: den ville overskrive
# serverens runtime-DSN fra Dokploy. Derfor unset ved tom værdi.
# NEXT_PUBLIC_SENTRY_BROWSER_ENABLED=false slår browser-Sentry fra.
RUN --mount=type=cache,target=/app/.next/cache \
    echo "Next build cache before build: $(du -sh .next/cache .next/cache/turbopack 2>/dev/null | tr "\n" " ")"; \
    if [ -z "$NEXT_PUBLIC_SENTRY_DSN" ]; then unset NEXT_PUBLIC_SENTRY_DSN; fi; \
    if [ -z "$NEXT_PUBLIC_SENTRY_BROWSER_ENABLED" ]; then unset NEXT_PUBLIC_SENTRY_BROWSER_ENABLED; fi; \
    CI_SKIP_TYPECHECK="$CI_SKIP_TYPECHECK" npm run build && \
    echo "Next build cache after build: $(du -sh .next/cache .next/cache/turbopack 2>/dev/null | tr "\n" " ")"

# File tracing puts public/ and content/ (identical copies) and most of drizzle/
# into the standalone output, about 70 MB. The runner copies all three itself,
# so the traced copies would only ship the same files twice, in the standalone
# layer that changes and is pushed on every deploy.
RUN rm -rf .next/standalone/public .next/standalone/content .next/standalone/drizzle

# Production image, copy all the files and run next
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# Realtime timer sync (server flag). Paired with the build-time
# NEXT_PUBLIC_REALTIME_ENABLED client flag. Override REALTIME_ENABLED=false in
# the runtime env to disable without a rebuild.
ENV REALTIME_ENABLED=true

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy built application - handle both possible standalone structures
COPY --from=builder /app/public ./public
COPY --from=builder /app/LICENSE ./LICENSE
COPY --from=builder /app/licenses ./licenses

# Try to copy standalone output (handles both nested and flat structure)
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

# TimeWren-docs: llms.txt and the .md routes read content/docs at runtime.
COPY --from=builder /app/content ./content

# Copy database files (migrations, etc.)
COPY --from=builder /app/drizzle ./drizzle

# Copy drizzle config + tsconfig (tsx resolves @/* via tsconfig paths)
COPY --from=builder /app/drizzle.config.ts ./drizzle.config.ts
COPY --from=builder /app/tsconfig.json ./tsconfig.json

# Copy all of src/lib so migrate-safe.ts can dynamic-import @/lib/reports/seed
# + @/lib/db/schema, which themselves import from other @/lib/* paths.
COPY --from=builder /app/src/lib ./src/lib

# Copy package.json and production-only node_modules (for tsx migration scripts)
COPY --from=builder /app/package.json ./package.json
# --link: the layer depends only on deps-prod, not on the builder layers above
# it, so a source-only change reuses this ~1 GB layer as is (no new snapshot,
# no recompression, nothing to push). Same files as a plain COPY: the target
# is a real directory (from standalone), no --chown, no symlinks on the path.
COPY --link --from=deps-prod /app/node_modules ./node_modules

# Copy migration and startup scripts
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/cron/entrypoint.sh ./cron/entrypoint.sh
RUN chmod +x ./scripts/startup.sh

# .next/cache for image optimization, and .next/server because ISR writes
# revalidated pages (route-cache) there at runtime (TimeWren site, 8/11-26).
RUN mkdir -p .next/cache .next/server/route-cache \
  && chown -R nextjs:nodejs .next/cache .next/server

# Lokalt fillager (STORAGE_DRIVER=local): mountpunktet skal ejes af nextjs, ellers
# opretter Docker et root-ejet volume og uploads fejler med EACCES.
RUN mkdir -p /app/data/storage && chown -R nextjs:nodejs /app/data

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Same version as the build stage, read by the server at runtime (see the
# APP_VERSION arg above). Last, so a new SHA does not invalidate any layer.
ARG APP_VERSION
ENV APP_VERSION=$APP_VERSION

# Start the application with startup script
CMD ["./scripts/startup.sh"]
# CI: Build Docker-jobbet har 35 min timeout (kold npm-cache kan tage 12+ min)
