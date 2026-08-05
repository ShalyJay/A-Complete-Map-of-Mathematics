# Map of Mathematics

An explorable knowledge graph of mathematics — grand branches down to theorems — built from MSC 2020, Wikidata, and Wikipedia. Mark personal mastery and upload papers/exams for a coverage heatmap. Everything personal stays in your browser; the math graph lives in a local embedded database.

The map is a ring of 8 large branch bubbles with labels inside (branches that wrap a single MSC field, like Number Theory (11-XX) and Discrete Mathematics (05-XX), show the MSC code right on the branch bubble). Clicking a branch **pops it out of the ring** and fans its fields across the free space; each deeper level (field → subfield → topic) fans further outward. Several branches can be open at once — each fan is clamped so it never invades its expanded neighbor's arc. Within a section, **axioms hug the inner arc** (foundations point toward the center), theorems fan outward by derivation depth, and conjectures sit on the outermost row. Derivation arrows are drawn **above** the bubbles. Hover a theorem to trace its lineage; clicking one **pins** the full chain back to the axioms (it stays lit when the mouse moves away) — chain members from other branches appear on inner ghost rings, axioms nearest the center, so cross-branch dependencies read as chords.

Computer science (MSC 68), information theory (94), and mathematical physics (70–86) are included under the Applied & Computational branch.

## Quick start

```bash
npm install
npm run db:ensure        # create local PGlite graph tables
npm run ingest:all       # MSC + Wikidata + Wikipedia (~a few minutes; Wikidata needs network)
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Copy `.env.example` to `.env.local` only if you want a server-side Anthropic key for AI document analysis.

## Run with Docker

```bash
docker compose up --build
```

First start seeds the graph automatically (MSC taxonomy + Wikidata theorems, ~2 min).
Data persists in the `mathmap-data` volume. Options via environment variables:

- `AUTO_INGEST=full` — also fetch Wikipedia summaries/thumbnails on first run (~15 min extra, Wikipedia rate-limits)
- `AUTO_INGEST=none` — skip seeding
- `ANTHROPIC_API_KEY=sk-ant-…` — enable AI document analysis without pasting a key in the UI

Or without compose:

```bash
docker build -t math-map .
docker run -p 3000:3000 -v mathmap-data:/app/.data math-map
```

## Stack

- **Next.js** App Router + TypeScript
- **PGlite** (embedded Postgres in `.data/pglite`) for the math graph only
- **localStorage** for mastery ratings and document analyses
- **Drizzle ORM**
- **Sigma.js** / Graphology (2D) and three.js / react-three-fiber (3D)
- **Anthropic API** (optional) for document → MSC classification

## Ingestion

| Script | Source | What it adds |
|--------|--------|--------------|
| `npm run ingest:msc` | [MSC 2020 SKOS](https://github.com/TIBHannover/MSC2020_SKOS) Turtle | Grand branches, fields, subfields, topics + see-also edges (CS/info theory/math physics under Applied) |
| `npm run ingest:wikidata` | Wikidata SPARQL | Theorems, axioms, conjectures as leaf nodes + sparse dependency links |
| `npm run ingest:deps` | Curated dataset | Classic derivation chains (axiom → theorem → theorem) + seeds for famous results Wikidata misses |
| `npm run ingest:wikipedia` | Wikipedia Action API | Summaries + thumbnails for nodes with articles; title lookup for fields, subfields, and topics |

Cached downloads live in `data/cache/` (gitignored).

## Document analysis

Analyses are stored in **browser localStorage** (not on the server). Two methods:

- **Local NLP** (default) — extracts noun phrases with [`compromise`](https://github.com/spencermountain/compromise), then ranks MSC nodes with a tiny local embedding model ([`Xenova/all-MiniLM-L6-v2`](https://huggingface.co/Xenova/all-MiniLM-L6-v2) via [`@xenova/transformers`](https://www.npmjs.com/package/@xenova/transformers)). Offline after the first ~23 MB model download into `.data/hf-cache/`; node vectors cache in `.data/cache/node-embeddings.json`.
- **AI (Claude)** — semantic classification against the MSC taxonomy via the Anthropic API. Paste an API key in the form (used per-request, never stored) or set `ANTHROPIC_API_KEY` on the server.

## Map controls

- Click a bubble to expand it: it pops out of its ring and its children fan out with room to breathe; multiple branches can be open at once
- The selected bubble gets a bright ring + amber halo
- Hover a theorem to trace its derivation lineage; everything else dims
- Clicking a theorem pins its chain — arrows and dimming persist until you click elsewhere
- Derivation chains reach back to the axioms, even across collapsed branches
- Search jumps the camera and opens the ancestry path; tag chips filter by kind (axioms, theorems, lemmas, inequalities, conjectures, topics) and by branch — pick a tag with no query to browse everything under it
- Collapsed sections still show their interdependencies: hidden dependency endpoints roll up to the nearest visible bubble as aggregated orange arcs (thicker = more underlying links)
- Every node has a description: MSC topics without a scope note or Wikipedia page get one synthesized from their position, subtopics, and attached results
- Every connection is explained: the detail card lists each link under "Builds on" / "Leads to" / "See also" with a one-line note saying *why* the two results are connected (curated proof sketches for the derivation edges, synthesized text otherwise)
- **3D mode (default)**: the map renders as a navigable space (three.js / react-three-fiber) — drag to rotate, scroll to zoom, right-drag to pan. Expanding a bubble fans its children across a spherical cap around its outward direction, so open sections spread into the z axis too. Axioms sit on inner shells, theorems on outer shells by derivation level, and dependency chords arc through the space. The 2D radial map is one toggle away in the top-right corner
- **Mastery** overlay: green mastered → red problem areas → gray unexplored (saved in this browser)
- **Documents**: upload PDF/text → local NLP or AI analysis → orange coverage heatmap (saved in this browser)
