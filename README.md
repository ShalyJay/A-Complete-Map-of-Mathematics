# A Complete Map of Math, Physics & CS

An explorable knowledge graph of mathematics, physics and computer science: three domains, their branches and subject maps (MSC 2020 fields, subfields and topics for mathematics), down to concepts and named theorems, with prerequisite chains, cross-subject bridges and verified reference notes. Mark personal mastery and upload papers/exams for a coverage heatmap. Everything personal stays in your browser.

The graph is generated from a curated Obsidian research vault (the "Personal Wiki"): `data/vault/` is its public taxonomy export, refreshed automatically whenever the vault changes. Questions, research notes and anything personal in the vault are never exported.

The map is a ring of three large domain bubbles. Clicking one **pops it out of the ring** and fans its branches across the free space; each deeper level fans further outward, and several sections can be open at once. Within a section, **axioms hug the inner arc**, results fan outward by prerequisite depth, and conjectures sit on the outermost row. Hover a concept to trace its prerequisites; clicking one **pins** the chain; chain members from other areas appear on inner ghost rings.

## Quick start

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). To refresh the graph from a local copy of the vault: `VAULT_DIR=/path/to/vault npm run sync:vault`.

Copy `.env.example` to `.env.local` only if you want a server-side Anthropic key for AI document analysis.

## Deploy

The API reads the committed `data/vault/` files, so any Node host works (Vercel included); `npm run build` validates the graph first and fails on a broken export.

## Run with Docker

```bash
docker compose up --build
```

Optional: `ANTHROPIC_API_KEY=sk-ant-…` enables AI document analysis without pasting a key in the UI.

## Stack

- **Next.js** App Router + TypeScript
- **Vault export** (`data/vault/`) as the only graph source; no database
- **localStorage** for mastery ratings and document analyses
- **Sigma.js** / Graphology (2D) and three.js / react-three-fiber (3D)
- **Anthropic API** (optional) for document → subject classification

## Where the data comes from

| Source | Lives in the vault as | What the site shows |
|--------|----------------------|---------------------|
| Vault subject maps (math, physics, CS) | `_tools/taxonomy/*_structure.yaml` + map notes | Domains, branches, fields/sections, subfields/subsections |
| [MSC 2020](https://msc2020.org/) | `msc2020.yaml`, `msc2020_topics.yaml` | MSC codes, topics and their see-also references |
| Vault concepts and imported results (Wikidata, curated seeds) | `math.yaml`, `math_results.yaml`, `physics.yaml`, `cs.yaml` + concept notes | Concepts and named results, prerequisites (independently verified), typed connections |
| Vault bridges and principles | `bridges.yaml`, `principles.yaml` | Cross-subject bridges with the principle they share and a source |
| Verified research blocks | `## Reference` sections with a `verified` date | The detail panel's Reference section (with LaTeX) |

Related research papers are **not** part of the graph. Opening a node’s detail panel queries the [arXiv API](https://info.arxiv.org/help/api/user-manual.html) live (title/abstract phrase search, scoped to the node's arXiv category or domain) and lists Abstract / PDF links.

## Document analysis

Analyses are stored in **browser localStorage** (not on the server). Two methods:

- **Local NLP** (default) — extracts noun phrases with [`compromise`](https://github.com/spencermountain/compromise), then ranks taxonomy nodes with a tiny local embedding model ([`Xenova/all-MiniLM-L6-v2`](https://huggingface.co/Xenova/all-MiniLM-L6-v2) via [`@xenova/transformers`](https://www.npmjs.com/package/@xenova/transformers)). Offline after the first ~23 MB model download into `.data/hf-cache/`; node vectors cache in `.data/cache/node-embeddings.json`.
- **AI (Claude)** — semantic classification against the subject taxonomy (MSC 2020 for mathematics) via the Anthropic API. Paste an API key in the form (used per-request, never stored) or set `ANTHROPIC_API_KEY` on the server.

## Map controls

- Click a bubble to expand it: it pops out of its ring and its children fan out with room to breathe; multiple branches can be open at once
- The selected bubble gets a bright ring + amber halo
- The detail panel lists live **arXiv papers** related to the selected theorem, conjecture, or topic (title/abstract search scoped to the node's category), with Abstract / PDF links and a full arXiv search shortcut
- Hover a theorem to trace its derivation lineage; everything else dims
- Clicking a theorem pins its chain — arrows and dimming persist until you click elsewhere
- Derivation chains reach back to the axioms, even across collapsed branches
- Search jumps the camera and opens the ancestry path; tag chips filter by kind (axioms, theorems, lemmas, inequalities, conjectures, topics) and by branch — pick a tag with no query to browse everything under it
- Collapsed sections still show their interdependencies: hidden dependency endpoints roll up to the nearest visible bubble as aggregated orange arcs (thicker = more underlying links)
- Every node has a description: the vault's summary, Wikipedia's intro (labelled), or one synthesized from its position and contents; verified Reference notes render with LaTeX
- Connections are grouped by kind: prerequisites (with the verified reason), bridges to other subjects (with the shared principle and a source), the vault's typed connections, and MSC see-also references
- **3D mode (default)**: the map renders as a navigable space (three.js / react-three-fiber) — drag to rotate, scroll to zoom, right-drag to pan. Expanding a bubble fans its children across a spherical cap around its outward direction, so open sections spread into the z axis too. Axioms sit on inner shells, theorems on outer shells by derivation level, and dependency chords arc through the space. The 2D radial map is one toggle away in the top-right corner
- **Mastery** overlay: green mastered → red problem areas → gray unexplored (saved in this browser)
- **Documents**: upload PDF/text → local NLP or AI analysis → orange coverage heatmap (saved in this browser)
