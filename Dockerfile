# A Complete Map of Math, Physics & CS — self-contained image.
# The graph is data/vault/ (generated from the Personal Wiki vault and committed); no database.
# Build:  docker build -t math-map .
# Run:    docker run -p 3000:3000 math-map
FROM node:22-alpine AS base
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM base AS runner
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000

COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY package.json next.config.ts tsconfig.json ./
COPY src ./src
COPY data ./data

# .data holds the local NLP model and embedding caches.
RUN mkdir -p .data && chown -R node:node /app
USER node

EXPOSE 3000
CMD ["sh", "-c", "exec ./node_modules/.bin/next start -H 0.0.0.0 -p ${PORT:-3000}"]
