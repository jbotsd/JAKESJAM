# JAKESJAM game server image. Build context is the REPO ROOT so we can copy
# both server/ and the shared client/src/sim/ into the image at the same
# relative paths the dev environment uses.
#
# Build:   docker build -f server/Dockerfile -t jakesjam-srv .
# Or via:  flyctl deploy --config fly.toml --app jakesjam-srv-syd

FROM oven/bun:1.1 AS base
WORKDIR /app

# Bring in shared sim + net packages first (small, rarely changes — caches well).
# `@sim/*` and `@net/*` path aliases in server/tsconfig.json point at these.
# Phase B1 (commit 2feac4b) consolidated protocol.ts and snapshotDelta.ts into
# client/src/net, so server now depends on this directory at runtime.
COPY client/src/sim ./client/src/sim
COPY client/src/net ./client/src/net

# Install server deps
COPY server/package.json server/bun.lockb* ./server/
WORKDIR /app/server
RUN bun install --frozen-lockfile || bun install

# Now the server source
COPY server/src ./src
COPY server/tsconfig.json ./

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

HEALTHCHECK --interval=10s --timeout=2s --retries=3 \
  CMD bun --eval "fetch('http://localhost:8080/health').then(r => r.ok ? process.exit(0) : process.exit(1))" || exit 1

CMD ["bun", "src/index.ts"]
