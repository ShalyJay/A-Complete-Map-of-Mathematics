# A Complete Map of Math, Physics & CS — Overview (stack, layout, architecture)

Open when: you need the stack, the folder layout, or how the pieces fit together before a larger change. Rewritten 2026-11-23 when the graph moved to the Personal Wiki vault.

## Stack

- TypeScript (strict), React 19, Next.js 16 App Router
- Tailwind CSS v4; CSS vars in `src/app/globals.css`
- Graphology + Sigma.js (2D); three.js + `@react-three/fiber` / `drei` (3D)
- Fuse.js, Zod, `unpdf`, `react-markdown` + `remark-math` + `rehype-katex` (Reference blocks), optional `@anthropic-ai/sdk` / `@xenova/transformers`
- No database: the graph is the vault export in `data/vault/`; deploy on Vercel or Docker

No test framework; the judges are `validate:graph`, `smoke:layout`, `tsc --noEmit`, `lint` and `build`.

## Where to look first

| Path | Why |
|------|-----|
| `src/lib/vaultGraph.ts` | Vault export → site model: ID scheme, types, depth, edge mapping |
| `src/lib/staticGraph.ts` | Loads `data/vault/` (mtime reload), `/api/graph` payload, node detail |
| `src/components/AppShell.tsx` | Client orchestration: fetch graph, expand/select, 2D/3D |
| `src/lib/branches.ts` | Domains and colour families |
| `src/lib/nodeKinds.ts` | Leaf vs map types |
| `src/lib/localStore.ts` | Mastery / documents in `localStorage` |
| `data/vault/` | Committed vault export (`graph.json`, `references.json`); generated, never hand-edited |

## Layout

| Path | Role |
|------|------|
| `src/app/` | App Router: `page.tsx` → `AppShell`, API routes |
| `src/app/api/graph/` | Full lightweight graph payload |
| `src/app/api/node/[id]/` | Node detail (summary, Wikipedia intro, verified Reference, connections) |
| `src/app/api/analyze/` | Document → taxonomy classification (no server writes) |
| `src/app/api/arxiv/` | Live arXiv search for a node |
| `src/components/map/` | `MathMap`, `MathMap3D`, layout, overlays, graphStore |
| `src/lib/` | Types, vault mapping, branches, analysis, NLP |
| `scripts/` | `sync-vault.ts`, `validate-graph.ts`, `smoke-layout.ts` |
| `.data/` | Gitignored local NLP model and embedding caches |

## Architecture

1. The vault's `export_site.py` writes `graph.json` + `references.json`; its git hook syncs them into `data/vault/` on GitHub `main`.
2. `staticGraph.ts` maps them (`vaultGraph.ts`) once per file change; client `GET /api/graph` → collapse single-child maps → Graphology graph.
3. Layout is expansion-driven (radial / spherical) around three domain roots; overlays from mastery / document heatmap.
4. Selection → `GET /api/node/[id]`; DetailPanel renders the verified Reference block and may call arXiv live.
5. Upload → `POST /api/analyze` → client stores results in `localStorage`.

**Node types:** `domain`, `branch`, `field` (MSC field or physics/CS section), `subfield`, `topic` (MSC topic), and leaves `concept | theorem | axiom | conjecture | definition`. Depth is the real tree depth.

**Edges:** `depends-on` (vault prereqs; `source` = dependent, `target` = prerequisite), `related` (vault `## Connections` relations, map crosslinks, secondary placements), `see-also` (MSC cross-references), `bridge` (Fable-checked cross-subject links with a principle), `child-of` (from `parentId`, server side only).

**Privacy split:** the graph is public and comes only from the vault's allowlisted export; mastery/docs keys `mathmap:mastery`, `mathmap:documents` are never server-persisted.
