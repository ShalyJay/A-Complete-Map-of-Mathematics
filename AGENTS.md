# A Complete Map of Math, Physics & CS (repo: Map of Mathematics) — AGENTS.md

## Agent contract

Read this file before changing the repo. After any feature change, architecture shift, new command, new env var, or new "do not break" constraint, **update this `AGENTS.md` in the same change**. Drop stale claims. Keep this file short and navigational — point at code; do not paste the README.

## What this is

**A Complete Map of Math, Physics & CS** (`math-map`, live at mathmap.site) is an explorable knowledge graph: three domains (Mathematics, Physics, Computer Science & AI) → branches → fields/sections → subfields/subsections → MSC topics → concepts and named results. Users expand a radial (2D Sigma) or spatial (3D R3F) map, pin prerequisite lineages, search/filter, read verified reference notes, rate mastery, and upload papers/exams for a coverage heatmap.

**The graph is generated from the Personal Wiki vault** (`../Personal Wiki/`, owner's decision 2026-11-23): the site is a wrapper over the vault's taxonomy. `data/vault/graph.json` and `references.json` are the vault's `_tools/export_site.py` output, committed here; nothing else feeds the graph. There is no database. Personal mastery and document analyses stay in browser `localStorage`.

## Ambition (set 2026-11-21; method: [../AGENTS.md](../AGENTS.md#working-ambitiously))

- **Outcome:** the graph stays correct and deployable without a manual smoke test, and follows the vault on its own.
- **Hard target:** zero dangling or cyclic `depends-on` edges, unique IDs, exact `childCount`, `/api/graph` ≤ 3.5 MB (2.68 MB on 2026-11-23), and a vault commit on `main` live on GitHub within ~2 minutes.
- **Outside judge:** `npm run validate:graph` (also `prebuild`, so a bad graph fails the deploy), `npm run smoke:layout` (headless client pipeline on the real data), `npx tsc --noEmit` and `npm run lint` (the completion hook runs both), `npm run build`; upstream, the vault's `export_site.py --check` (privacy/allowlist judge) runs before every sync.
- **Borrow from:** library science: classification QA against MSC; data engineering: referential-integrity checks.

## How to run

```bash
npm install
npm run dev              # http://localhost:3000 (reads data/vault/, reloads it when the files change)
npm run sync:vault       # refresh data/vault/ from the vault working tree ($VAULT_DIR, default ../Personal Wiki)
npm run validate:graph   # graph judge (also runs as prebuild)
npm run smoke:layout     # headless collapse/index/layout run on the real data
```

Also: `build` / `start` / `lint`. Docker: `docker compose up --build` (serves the committed `data/vault/`).

## How the site follows the vault

A commit or merge on the vault's `main` fires its versioned git hooks (`_tools/githooks/post-commit`, `post-merge`; enabled with `git config core.hooksPath _tools/githooks` in the vault). They start the vault's `_tools/site_sync.sh` in the background, which exports the **committed** vault (`git archive main`) with `export_site.py --check`, copies it into `data/vault/` in a dedicated worktree of this repo at `~/worktrees/mathmap-sync` (detached at `origin/main`), commits `Sync graph from vault (<hash>)` only if the export changed, and pushes to `origin main`; the host redeploys from GitHub. Your own checkout is never touched, so `git pull` before working. Log: `../Personal Wiki/_tools/.cache/site-sync.log`; off-switch: create `../Personal Wiki/_tools/.cache/site-sync.off`. Contract and privacy rules: `../Personal Wiki/_tools/agents/website.md`.

## Conventions

- Import alias `@/*` → `src/*`
- Client UI is `"use client"`; maps dynamically imported with `{ ssr: false }`
- API routes often `dynamic = "force-dynamic"`; Zod on analyze POST
- Domain/branch colours: single source `src/lib/branches.ts` (hue family per domain, shade per top-level branch)
- Ask the node type, not its depth: `src/lib/nodeKinds.ts` (`isLeafType`); depth varies (a theorem can sit under a field, subfield or MSC topic)
- Shared types: `src/lib/types.ts`
- No Redux/Zustand — React state in `AppShell` + Graphology

## Do not break

1. **The vault is the only graph source.** Never hand-edit `data/vault/`; change the vault and let the hook sync (or `npm run sync:vault` locally). Don't reintroduce ingest scripts or a database; fix missing content in the vault.
2. **Privacy split.** Only what `export_site.py` allows is public (taxonomy + verified Reference blocks; never questions, research, sources or `status`). Mastery/docs stay in `localStorage` (`mathmap:mastery`, `mathmap:documents`); the analyze API classifies only.
3. **Export contract.** `src/lib/vaultGraph.ts` maps the export (version 1) to site IDs: `domain:<d>`, `msc:NN-XX` / `msc:NNLxx` / `msc:<topic>`, `<domain>:<structure_id>`, `wd:<QID>`, `c:<title>`. IDs key saved mastery and document heatmaps; changing the scheme orphans them. Bump the version on both sides together.
4. **`depends-on` direction** — dependent → prerequisite (vault `prereqs`); layout and DetailPanel assume this.
5. **`collapseSingleFieldBranches`** — merges a map whose only child is a map; don't undo without updating layout/labels.
6. **Turbopack root** pinned in `next.config.ts` (Desktop parent can confuse Turbopack); `outputFileTracingIncludes` ships `data/vault/` with the API routes.
7. **arXiv** is live-only; respect rate limits / cache in `src/lib/arxiv.ts`; category filter comes from the node's domain or arXiv code.
8. **Pre-vault history** (MSC/Wikidata/Wikipedia ingest, PGlite) is at tag `pre-vault`; its content now lives in the vault.

## Verification

- `npx tsc --noEmit` and `npm run lint` after TS/UI changes. Lint is ESLint run from `tools/lint/` (its own `node_modules`, installed on first run): Next 16 dropped `next lint`, and typescript-eslint cannot load TypeScript 7, which the build needs, so the linter has TypeScript 6 to itself. It passes with 16 warnings (2026-11-23): three React Compiler rules are set to warn in `tools/lint/eslint.config.mjs` because existing map code trips them; new errors fail.
- `npm run validate:graph` and `npm run smoke:layout` after data or map changes; `npm run build` before deploy.
- Manually smoke the map: expand each domain, open a concept with a Reference block (math renders), a bridge, an MSC topic, a theorem; toggle 2D/3D; check mastery still client-only.

## Secrets / config

| Name | Purpose |
|------|---------|
| `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL` | Optional server-side LLM analyze |
| `VAULT_DIR` | Vault location for `npm run sync:vault` (default `../Personal Wiki`) |

Copy from `.env.example` → `.env.local`. Never commit secrets. UI-pasted Anthropic keys are per-request only.

## Related projects

- Generated from the Personal Wiki vault (see above); the vault imported this site's pre-vault content on 2026-11-23.
- Linked from Personal Website (yellow apple / `VITE_MATH_MAP_URL`).
- Sibling orientation: workspace root [`AGENTS.md`](../AGENTS.md).

## Common tasks

- **Change the graph:** edit the vault (taxonomy YAML via its tools), commit/merge on vault `main`; the hook publishes. Check `site-sync.log` if nothing arrives.
- **Change colours:** `src/lib/branches.ts`.

## More detail (open only when the task needs it)

- [docs/agents/overview.md](docs/agents/overview.md) — open when you need the stack, the folder layout, or how the pieces fit together before a larger change.
