# Map of Mathematics — AGENTS.md

## Agent contract

Read this file before changing the repo. After any feature change, architecture shift, new command, new env var, or new "do not break" constraint, **update this `AGENTS.md` in the same change**. Drop stale claims. Keep this file short and navigational — point at code; do not paste the README.

## What this is

**Map of Mathematics** (`math-map`) is an explorable knowledge graph of mathematics: grand branches → MSC fields/topics → theorems/axioms/conjectures. Users expand a radial (2D Sigma) or spatial (3D R3F) map, pin dependency lineages, search/filter, rate mastery, and upload papers/exams for a coverage heatmap.

It is **not** a multi-user backend: the shared graph lives in PGlite / static JSON / optional Postgres; personal mastery and document analyses stay in browser `localStorage`.

## Ambition (set 2026-11-21; method: [../AGENTS.md](../AGENTS.md#working-ambitiously))

- **Outcome:** the graph stays correct and deployable without a manual smoke test.
- **Hard target:** zero dangling or cyclic `depends-on` edges in `data/static-graph.json`, and zero curated deps silently skipped by `scripts/ingest-dependencies.ts` (current: unmeasured).
- **Outside judge:** `npm run lint`, `npm run build`. To build: a validator over `data/static-graph.json` that also reports every skipped curated title.
- **Borrow from:** library science: classification QA against MSC; data engineering: referential-integrity checks.

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

## How to run

```bash
npm install
npm run db:ensure        # create PGlite tables
npm run ingest:all       # network; minutes (optional if static graph exists)
npm run export:graph     # write data/static-graph.json (needed for Vercel)
npm run dev              # http://localhost:3000
```

Also: `build` / `start` / `lint`; `db:push` / `db:studio`; per-source `ingest:*`. Docker: `docker compose up --build`.

## Architecture

1. Ingest scripts write `nodes` + `edges` into PGlite (or Postgres).
2. Client `GET /api/graph` → `GraphPayload` → collapse single-field branches → Graphology graph.
3. Layout is expansion-driven (radial / spherical); overlays from mastery / document heatmap.
4. Selection → `GET /api/node/[id]`; DetailPanel may call arXiv live.
5. Upload → `POST /api/analyze` → client stores results in `localStorage`.

**Backend switch** (`graphAccess.ts`): `DATABASE_URL` → Postgres; else `VERCEL=1` or `USE_STATIC_GRAPH=1` → static JSON; else PGlite (may fall back to static if empty).

**Privacy split:** graph only in DB/static file; mastery/docs keys `mathmap:mastery`, `mathmap:documents` — never server-persisted.

**IDs / edges:** prefixes `branch:`, `msc:`, `wd:Q…`, `seed:…`. Map edges: `see-also` | `related` | `depends-on` (`source` = dependent, `target` = prerequisite).

## Conventions

- Import alias `@/*` → `src/*`
- Client UI is `"use client"`; maps dynamically imported with `{ ssr: false }`
- API routes often `dynamic = "force-dynamic"`; Zod on analyze POST
- Branch colors / MSC grouping: single source `src/lib/branches.ts`
- Shared types: `src/lib/types.ts`
- No Redux/Zustand — React state in `AppShell` + Graphology

## Do not break

1. **PGlite single-writer** — do not run ingest while `next dev` holds `.data/pglite`.
2. **Privacy split** — never put mastery/docs in the DB; analyze API classifies only.
3. **`data/static-graph.json`** — required for Vercel; regenerate with `export:graph` after graph changes and commit it (not under `data/cache/`).
4. **`depends-on` direction** — dependent → prerequisite; layout and DetailPanel assume this.
5. **`collapseSingleFieldBranches`** — client merge; don't undo without updating layout/labels.
6. **`GRAND_BRANCHES` MSC prefixes** — changing prefixes breaks ingest mapping and colors.
7. **Curated deps** in `scripts/ingest-dependencies.ts` — unmatched titles are skipped.
8. **Turbopack root** pinned in `next.config.ts` (Desktop parent can confuse Turbopack).
9. **arXiv** is live-only; respect rate limits / cache in `src/lib/arxiv.ts`.
10. No committed `drizzle/` migrations tree — schema via `db:ensure` / `db:push`.

## Verification

- `npm run lint` after TS/UI changes.
- `npm run build` before deploy; ensure `data/static-graph.json` is present/fresh if graph changed.
- Manually smoke the map: expand a branch, open detail, toggle 2D/3D, check mastery still client-only.

## Secrets / config

| Name | Purpose |
|------|---------|
| `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL` | Optional server-side LLM analyze |
| `DATABASE_URL` | Hosted Postgres instead of PGlite |
| `USE_STATIC_GRAPH=1` | Force static JSON locally |
| `VERCEL=1` | Implies static graph path |
| `AUTO_INGEST` | Docker: `basic` \| `full` \| `none` |

Copy from `.env.example` → `.env.local`. Never commit secrets. UI-pasted Anthropic keys are per-request only.

## Related projects

- Linked from Personal Website (yellow apple / `VITE_MATH_MAP_URL`).
- Sibling orientation: workspace root [`AGENTS.md`](../AGENTS.md).

## Common tasks

- **Refresh graph for Vercel:** ingest (if needed) → `npm run export:graph` → commit `data/static-graph.json`.
- **Add/adjust grand branches:** edit `src/lib/branches.ts`, then re-ingest/export as needed.
