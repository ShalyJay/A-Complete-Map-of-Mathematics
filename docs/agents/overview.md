# Map of Mathematics — Overview (stack, layout, architecture)

Open when: you need the stack, the folder layout, or how the pieces fit together before a larger change. Moved word for word from `AGENTS.md` on 2026-11-23 to keep that file short; update it here.

## Stack

- TypeScript (strict), React 19, Next.js 16 App Router
- Tailwind CSS v4; CSS vars in `src/app/globals.css`
- Drizzle ORM + PGlite (`.data/pglite`) or `DATABASE_URL` Postgres
- Graphology + Sigma.js (2D); three.js + `@react-three/fiber` / `drei` (3D)
- Fuse.js, Zod, `unpdf`, optional `@anthropic-ai/sdk` / `@xenova/transformers`
- Ingest via `tsx` scripts; deploy on Vercel (static graph) or Docker

No test framework in `package.json` — only `npm run lint`.

## Where to look first

| Path | Why |
|------|-----|
| `src/components/AppShell.tsx` | Client orchestration: fetch graph, expand/select, 2D/3D |
| `src/lib/graphAccess.ts` | DB vs static-graph backend switch |
| `src/lib/branches.ts` | `GRAND_BRANCHES` — MSC prefixes and colors |
| `src/lib/localStore.ts` | Mastery / documents in `localStorage` |
| `src/db/schema.ts` | `nodes` / `edges` schema |
| `data/static-graph.json` | Committed Vercel/offline graph export |

## Layout

| Path | Role |
|------|------|
| `src/app/` | App Router: `page.tsx` → `AppShell`, API routes |
| `src/app/api/graph/` | Full lightweight graph payload |
| `src/app/api/node/[id]/` | Node detail |
| `src/app/api/analyze/` | Document → MSC classification (no user DB writes) |
| `src/app/api/arxiv/` | Live arXiv search for a node |
| `src/components/map/` | `MathMap`, `MathMap3D`, layout, overlays, graphStore |
| `src/lib/` | Types, branches, static graph, analysis, NLP |
| `scripts/` | Schema ensure + MSC/Wikidata/Wikipedia/deps ingest + export |
| `data/cache/` | Gitignored ingest caches |
| `.data/` | Gitignored PGlite + model cache |

## Architecture

1. Ingest scripts write `nodes` + `edges` into PGlite (or Postgres).
2. Client `GET /api/graph` → `GraphPayload` → collapse single-field branches → Graphology graph.
3. Layout is expansion-driven (radial / spherical); overlays from mastery / document heatmap.
4. Selection → `GET /api/node/[id]`; DetailPanel may call arXiv live.
5. Upload → `POST /api/analyze` → client stores results in `localStorage`.

**Backend switch** (`graphAccess.ts`): `DATABASE_URL` → Postgres; else `VERCEL=1` or `USE_STATIC_GRAPH=1` → static JSON; else PGlite (may fall back to static if empty).

**Privacy split:** graph only in DB/static file; mastery/docs keys `mathmap:mastery`, `mathmap:documents` — never server-persisted.

**IDs / edges:** prefixes `branch:`, `msc:`, `wd:Q…`, `seed:…`. Map edges: `see-also` | `related` | `depends-on` (`source` = dependent, `target` = prerequisite).
