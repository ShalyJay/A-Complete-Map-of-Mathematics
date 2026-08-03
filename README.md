# Map of Mathematics

An explorable knowledge graph of mathematics — grand branches down to theorems — built from MSC 2020, Wikidata, and Wikipedia. Mark personal mastery, and upload papers/exams to see coverage as a heatmap.

## Quick start (no external services)

```bash
npm install
npm run db:ensure        # create tables (PGlite by default)
npm run ingest:all       # MSC + Wikidata + Wikipedia (~a few minutes; Wikidata needs network)
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The map works without signing in.

Copy `.env.example` to `.env.local` when you want Supabase auth or document analysis.

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
| `npm run ingest:msc` | [MSC 2020 SKOS](https://github.com/TIBHannover/MSC2020_SKOS) Turtle | Grand branches, fields, subfields, topics + see-also edges |
| `npm run ingest:wikidata` | Wikidata SPARQL | Theorems, axioms, conjectures as leaf nodes |
| `npm run ingest:wikipedia` | Wikipedia REST | Summaries + thumbnails for nodes with articles |

Cached downloads live in `data/cache/` (gitignored).

## Optional: Supabase + Anthropic

1. Create a Supabase project; put URL + anon key in `.env.local`.
2. Point `DATABASE_URL` at Supabase Postgres (or keep PGlite for local graph data and only use Supabase for auth).
3. Enable Google and/or email magic-link providers; set redirect URL to `http://localhost:3000/auth/callback`.
4. Add `ANTHROPIC_API_KEY` to enable **Documents → Analyze**.

## Map controls

- Click a node to select and expand children
- Search jumps the camera and opens the ancestry path
- **Mastery** overlay (signed in): green mastered → red problem areas → gray unexplored
- **Documents**: upload PDF/text → LLM tags MSC areas → orange coverage heatmap
