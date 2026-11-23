# Map of Mathematics — AGENTS.md

## Agent contract

Read this file before changing the repo. After any feature change, architecture shift, new command, new env var, or new "do not break" constraint, **update this `AGENTS.md` in the same change**. Drop stale claims. Keep this file short and navigational — point at code; do not paste the README.

## What this is

**Map of Mathematics** (`math-map`) is an explorable knowledge graph of mathematics: grand branches → MSC fields/topics → theorems/axioms/conjectures. Users expand a radial (2D Sigma) or spatial (3D R3F) map, pin dependency lineages, search/filter, rate mastery, and upload papers/exams for a coverage heatmap.

It is **not** a multi-user backend: the shared graph lives in PGlite / static JSON / optional Postgres; personal mastery and document analyses stay in browser `localStorage`.

## Ambition (set 2026-11-21; method: [../AGENTS.md](../AGENTS.md#working-ambitiously))

- **Outcome:** the graph stays correct and deployable without a manual smoke test.
- **Hard target:** zero dangling or cyclic `depends-on` edges in `data/static-graph.json`, and zero curated deps silently skipped by `scripts/ingest-dependencies.ts` (current: unmeasured).
- **Outside judge:** `npx tsc --noEmit` and `npm run lint` (the completion hook runs both), `npm run build`. To build: a validator over `data/static-graph.json` that also reports every skipped curated title.
- **Borrow from:** library science: classification QA against MSC; data engineering: referential-integrity checks.

## How to run

```bash
npm install
npm run db:ensure        # create PGlite tables
npm run ingest:all       # network; minutes (optional if static graph exists)
npm run export:graph     # write data/static-graph.json (needed for Vercel)
npm run dev              # http://localhost:3000
```

Also: `build` / `start` / `lint`; `db:push` / `db:studio`; per-source `ingest:*`. Docker: `docker compose up --build`.

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

- `npx tsc --noEmit` and `npm run lint` after TS/UI changes. Lint is ESLint run from `tools/lint/` (its own `node_modules`, installed on first run): Next 16 dropped `next lint`, and typescript-eslint cannot load TypeScript 7, which the build needs, so the linter has TypeScript 6 to itself. It passes with 16 warnings (2026-11-23): three React Compiler rules are set to warn in `tools/lint/eslint.config.mjs` because existing map code trips them; new errors fail.
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

## More detail (open only when the task needs it)

- [docs/agents/overview.md](docs/agents/overview.md) — open when you need the stack, the folder layout, or how the pieces fit together before a larger change.
