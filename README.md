# Map of Mathematics

An explorable knowledge graph of mathematics — grand branches down to theorems — built from MSC 2020, Wikidata, and Wikipedia. Mark personal mastery, and upload papers/exams to see coverage as a heatmap.

The map is a ring of 8 large branch bubbles with labels inside (branches that wrap a single MSC field, like Number Theory (11-XX) and Discrete Mathematics (05-XX), show the MSC code right on the branch bubble). Clicking a branch **pops it out of the ring** and fans its fields across the free space; each deeper level (field → subfield → topic) fans further outward. Several branches can be open at once — each fan is clamped so it never invades its expanded neighbor's arc. Within a section, **axioms hug the inner arc** (foundations point toward the center), theorems fan outward by derivation depth, and conjectures sit on the outermost row. Derivation arrows are drawn **above** the bubbles. Hover a theorem to trace its lineage; clicking one **pins** the full chain back to the axioms (it stays lit when the mouse moves away) — chain members from other branches appear on inner ghost rings, axioms nearest the center, so cross-branch dependencies read as chords.

Physics and computer science are planned future additions and are deliberately excluded from the mathematics map.

## Quick start (no external services)

```bash
npm install
npm run db:ensure        # create tables (PGlite by default)
npm run ingest:all       # MSC + Wikidata + Wikipedia (~a few minutes; Wikidata needs network)
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The map works without signing in.

Copy `.env.example` to `.env.local` when you want Supabase auth or a server-side Anthropic key.

## Run with Docker

```bash
docker compose up --build
```

First start seeds the database automatically (MSC taxonomy + Wikidata theorems, ~2 min).
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
- **Postgres** via Supabase *or* embedded **PGlite** (`.data/pglite`)
- **Drizzle ORM**
- **Sigma.js** / Graphology for WebGL graph rendering
- **Anthropic API** for document → MSC classification
- **Supabase Auth** (optional) for mastery overlays

## Ingestion

| Script | Source | What it adds |
|--------|--------|--------------|
| `npm run ingest:msc` | [MSC 2020 SKOS](https://github.com/TIBHannover/MSC2020_SKOS) Turtle | Grand branches, fields, subfields, topics + see-also edges (physics/CS sections pruned) |
| `npm run ingest:wikidata` | Wikidata SPARQL | Theorems, axioms, conjectures as leaf nodes + sparse dependency links |
| `npm run ingest:deps` | Curated dataset | Classic derivation chains (axiom → theorem → theorem) + seeds for famous results Wikidata misses |
| `npm run ingest:wikipedia` | Wikipedia REST | Summaries + thumbnails for nodes with articles |

Cached downloads live in `data/cache/` (gitignored).

## Document analysis

Two methods, selectable in the upload form:

- **Keyword matching** (default) — scans the text for MSC topic titles and named theorems. Fast, offline, no API key.
- **AI (Claude)** — semantic classification against the MSC taxonomy via the Anthropic API. Paste an API key in the form (used per-request, never stored) or set `ANTHROPIC_API_KEY` on the server.

## Optional: Supabase + Anthropic

1. Create a Supabase project; put URL + anon key in `.env.local`.
2. Point `DATABASE_URL` at Supabase Postgres (or keep PGlite for local graph data and only use Supabase for auth).
3. Enable Google and/or email magic-link providers; set redirect URL to `http://localhost:3000/auth/callback`.
4. Add `ANTHROPIC_API_KEY` so AI analysis works without pasting a key in the UI.

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
- **Mastery** overlay (signed in): green mastered → red problem areas → gray unexplored
- **Documents**: upload PDF/text → keyword or AI analysis tags MSC areas → orange coverage heatmap
