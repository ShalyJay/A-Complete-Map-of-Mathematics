/**
 * Fetch Wikipedia REST summaries (+ thumbnails) for every node that has a
 * known article, and attempt title-based lookups for branches/fields/subfields
 * that don't have one yet.
 *
 * Usage: npm run ingest:wikipedia   (run ingest:msc + ingest:wikidata first)
 */
import fs from "node:fs";
import path from "node:path";
import { eq, isNotNull, isNull, and, inArray } from "drizzle-orm";
import { getDb, schema } from "../src/db/index";
import { mapWithConcurrency, sleep } from "./lib";

const CACHE_PATH = path.join(process.cwd(), "data", "cache", "wikipedia-summaries.json");
const USER_AGENT = "MathMapIngest/0.1 (personal project; map of mathematics)";

/** Hand-picked articles for the curated grand branches. */
const BRANCH_ARTICLES: Record<string, string> = {
  "branch:foundations": "Foundations of mathematics",
  "branch:algebra": "Algebra",
  "branch:number-theory": "Number theory",
  "branch:analysis": "Mathematical analysis",
  "branch:geometry-topology": "Geometry",
  "branch:discrete-cs": "Discrete mathematics",
  "branch:probability-statistics": "Probability theory",
  "branch:applied": "Applied mathematics",
  "branch:physics": "Mathematical physics",
};

interface Summary {
  ok: boolean;
  title?: string;
  extract?: string;
  thumbnail?: string;
  url?: string;
  disambiguation?: boolean;
}

type Cache = Record<string, Summary>;

function loadCache(): Cache {
  return fs.existsSync(CACHE_PATH) ? JSON.parse(fs.readFileSync(CACHE_PATH, "utf8")) : {};
}

async function fetchSummary(title: string, cache: Cache): Promise<Summary> {
  if (cache[title]) return cache[title];
  const enc = encodeURIComponent(title.replace(/ /g, "_"));
  let res: Response | undefined;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      res = await fetch(
        `https://en.wikipedia.org/api/rest_v1/page/summary/${enc}?redirect=true`,
        {
          headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
          signal: AbortSignal.timeout(20_000),
        },
      );
    } catch {
      await sleep(1500 * 2 ** attempt);
      continue;
    }
    if (res.status !== 429 && res.status < 500) break;
    await sleep(1500 * 2 ** attempt);
  }
  let out: Summary = { ok: false };
  if (res && res.ok) {
    const json = (await res.json()) as {
      title?: string;
      extract?: string;
      type?: string;
      thumbnail?: { source: string };
      content_urls?: { desktop?: { page?: string } };
    };
    out = {
      ok: true,
      title: json.title,
      extract: json.extract,
      thumbnail: json.thumbnail?.source,
      url: json.content_urls?.desktop?.page,
      disambiguation: json.type === "disambiguation",
    };
  }
  cache[title] = out;
  return out;
}

function titleFromUrl(url: string): string {
  return decodeURIComponent(url.replace(/^https?:\/\/en\.wikipedia\.org\/wiki\//, "")).replace(/_/g, " ");
}

async function main() {
  const db = await getDb();
  const cache = loadCache();
  let saved = 0;
  const persist = () => {
    fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
    fs.writeFileSync(CACHE_PATH, JSON.stringify(cache));
  };

  // ---- 1. Nodes with a known article url -----------------------------------
  const withUrl = await db
    .select({ id: schema.nodes.id, url: schema.nodes.wikipediaUrl })
    .from(schema.nodes)
    .where(isNotNull(schema.nodes.wikipediaUrl));
  console.log(`${withUrl.length} nodes with known Wikipedia articles`);

  let updated = 0;
  await mapWithConcurrency(withUrl, 4, async (n) => {
    const s = await fetchSummary(titleFromUrl(n.url!), cache);
    if (s.ok && s.extract && !s.disambiguation) {
      await db
        .update(schema.nodes)
        .set({
          summary: s.extract,
          thumbnailUrl: s.thumbnail ?? null,
          wikipediaUrl: s.url ?? n.url,
        })
        .where(eq(schema.nodes.id, n.id));
      updated++;
    }
    if (++saved % 200 === 0) {
      persist();
      console.log(`  ${saved}/${withUrl.length} fetched`);
    }
  });
  persist();
  console.log(`Updated ${updated} nodes from known articles`);

  // ---- 2. Grand branches (hand-picked articles) ------------------------------
  for (const [nodeId, article] of Object.entries(BRANCH_ARTICLES)) {
    const s = await fetchSummary(article, cache);
    if (s.ok && s.extract) {
      await db
        .update(schema.nodes)
        .set({ thumbnailUrl: s.thumbnail ?? null, wikipediaUrl: s.url ?? null })
        .where(eq(schema.nodes.id, nodeId));
    }
  }
  persist();
  console.log("Branch articles linked (curated summaries kept)");

  // ---- 3. Title-based lookup for fields/subfields without an article ---------
  const candidates = await db
    .select({ id: schema.nodes.id, title: schema.nodes.title })
    .from(schema.nodes)
    .where(
      and(
        isNull(schema.nodes.wikipediaUrl),
        inArray(schema.nodes.type, ["field", "subfield"]),
      ),
    );
  console.log(`${candidates.length} fields/subfields without an article — trying title lookup`);

  let found = 0;
  await mapWithConcurrency(candidates, 4, async (n) => {
    // MSC titles are often lists ("Sequences, series, summability") — try the
    // full title, then the first comma/semicolon-separated segment.
    const attempts = [n.title, n.title.split(/[;,]/)[0].trim()].filter(
      (t, i, a) => t.length > 3 && a.indexOf(t) === i,
    );
    for (const t of attempts) {
      const s = await fetchSummary(t, cache);
      if (s.ok && s.extract && !s.disambiguation) {
        await db
          .update(schema.nodes)
          .set({
            summary: s.extract,
            thumbnailUrl: s.thumbnail ?? null,
            wikipediaUrl: s.url ?? null,
          })
          .where(eq(schema.nodes.id, n.id));
        found++;
        break;
      }
    }
    if (++saved % 200 === 0) persist();
  });
  persist();
  console.log(`Found articles for ${found} additional fields/subfields`);
  console.log("Wikipedia ingestion complete.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
