FROM node:24-bookworm-slim

WORKDIR /app
RUN npm install --global pnpm@12.9.1

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY ingest/package.json ingest/package.json
COPY packages/db/package.json packages/db/package.json
COPY dashboard/package.json dashboard/package.json
RUN pnpm install --frozen-lockfile --filter @statsarena/ingest...

COPY ingest/src ingest/src
COPY ingest/config ingest/config
COPY packages/db/src packages/db/src

RUN mkdir -p ingest/snapshots ingest/audit ingest/.locks \
    && chown -R node:node ingest/snapshots ingest/audit ingest/.locks

ENV NODE_ENV=production
USER node
HEALTHCHECK --interval=30s --timeout=10s --start-period=180s --retries=3 \
    CMD ["node", "--import", "tsx", "/app/ingest/src/service-health.ts"]
WORKDIR /app/ingest
CMD ["node", "--import", "tsx", "src/cli.ts", "runner", "service"]
