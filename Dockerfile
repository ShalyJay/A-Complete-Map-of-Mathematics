# Map of Mathematics — self-contained image (embedded PGlite database).
# Build:  docker build -t math-map .
# Run:    docker run -p 3000:3000 -v mathmap-data:/app/.data math-map
FROM node:22-alpine AS base
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# data/cache may not exist in a fresh clone; the entrypoint downloads what it needs.
RUN mkdir -p data/cache && npm run build

FROM base AS runner
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000

# Full node_modules: tsx + ingest scripts run at container start for seeding.
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY package.json next.config.ts tsconfig.json drizzle.config.ts ./
COPY src ./src
COPY scripts ./scripts
COPY docker ./docker
# Baked ingestion caches (if present) make first-run seeding fast and offline.
COPY --from=build /app/data ./data

RUN mkdir -p .data && chown -R node:node /app
USER node

EXPOSE 3000
ENTRYPOINT ["sh", "docker/entrypoint.sh"]
