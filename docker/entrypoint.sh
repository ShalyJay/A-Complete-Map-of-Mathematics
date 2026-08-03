#!/bin/sh
# Entrypoint: ensure the database schema exists, seed it on first run,
# then start the Next.js server.
#
# AUTO_INGEST controls first-run seeding when the database is empty:
#   basic (default) — MSC taxonomy + Wikidata theorems (~2 min, uses baked cache when present)
#   full            — also fetch Wikipedia summaries/thumbnails (adds ~15 min, rate-limited)
#   none            — skip seeding entirely
set -e

MODE="${AUTO_INGEST:-basic}"

node --import tsx scripts/ensure-schema.ts

if [ "$MODE" != "none" ]; then
  COUNT="$(node --import tsx scripts/node-count.ts | tail -n 1)"
  if [ "$COUNT" = "0" ]; then
    echo "Empty database — seeding (AUTO_INGEST=$MODE)..."
    node --import tsx scripts/ingest-msc.ts
    node --import tsx scripts/ingest-wikidata.ts
    node --import tsx scripts/ingest-dependencies.ts
    if [ "$MODE" = "full" ]; then
      node --import tsx scripts/ingest-wikipedia.ts
    fi
  fi
fi

exec ./node_modules/.bin/next start -H 0.0.0.0 -p "${PORT:-3000}"
