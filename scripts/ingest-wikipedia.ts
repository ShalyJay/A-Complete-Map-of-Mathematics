/**
 * Fetch Wikipedia intro extracts (+ thumbnails) for every node that has a
 * known article, and attempt title-based lookups for branches/fields/subfields
 * that don't have one yet.
 *
 * Uses the batched MediaWiki Action API (20 titles per request) — the REST
 * summary endpoint rate-limits per-title fetching far too aggressively.
 *
 * Usage: npm run ingest:wikipedia   (run ingest:msc + ingest:wikidata first)
 */
import fs from "node:fs";
import path from "node:path";
import { eq, isNotNull, isNull, and, inArray } from "drizzle-orm";
import { getDb, schema } from "../src/db/index";
import { chunk, sleep } from "./lib";

const CACHE_PATH = path.join(process.cwd(), "data", "cache", "wikipedia-summaries.json");
const USER_AGENT = "MathMapIngest/0.1 (personal project; map of mathematics)";
const API = "https://en.wikipedia.org/w/api.php";
const BATCH_SIZE = 20; // exlimit maximum
const BATCH_DELAY_MS = 1200;

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
  if (!fs.existsSync(CACHE_PATH)) return {};
  const raw = JSON.parse(fs.readFileSync(CACHE_PATH, "utf8")) as Cache;
  // Drop failed entries so rate-limited / transient failures retry on rerun.
  return Object.fromEntries(Object.entries(raw).filter(([, v]) => v.ok));
}

interface ApiPage {
  title: string;
  missing?: boolean;
  extract?: string;
  thumbnail?: { source: string };
  fullurl?: string;
  pageprops?: Record<string, string>;
}

interface ApiResponse {
  continue?: Record<string, string>;
  query?: {
    normalized?: { from: string; to: string }[];
    redirects?: { from: string; to: string }[];
    pages?: ApiPage[];
  };
}

async function apiQuery(params: URLSearchParams): Promise<ApiResponse> {
  for (let attempt = 0; attempt < 10; attempt++) {
    let res: Response;
    try {
      res = await fetch(`${API}?${params}`, {
        headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      await sleep(3000 * Math.min(attempt + 1, 5));
      continue;
    }
    if (res.status === 429 || res.status >= 500) {
      const retryAfter = Number(res.headers.get("retry-after"));
      const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 + 500 : 8000;
      console.log(`  rate limited (${res.status}), waiting ${Math.round(wait / 1000)}s...`);
      await sleep(wait);
      continue;
    }
    if (!res.ok) throw new Error(`Wikipedia API error ${res.status}`);
    return (await res.json()) as ApiResponse;
  }
  throw new Error("Wikipedia API kept failing after 10 attempts");
}

function titleFromUrl(url: string): string {
  return decodeURIComponent(url.replace(/^https?:\/\/en\.wikipedia\.org\/wiki\//, "")).replace(/_/g, " ");
}

async function main() {
  const db = await getDb();
  const cache = loadCache();
  const persist = () => {
    fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
    fs.writeFileSync(CACHE_PATH, JSON.stringify(cache));
  };

  /** Fill the cache for all given titles using batched queries. */
  async function fetchBatch(titles: string[]): Promise<void> {
    const need = [...new Set(titles)].filter((t) => t && !t.includes("|") && !(t in cache));
    if (need.length === 0) return;
    const groups = chunk(need, BATCH_SIZE);
    let done = 0;
    for (const group of groups) {
      const byFinal = new Map<string, ApiPage>();
      const norm = new Map<string, string>();
      const redir = new Map<string, string>();
      let cont: Record<string, string> | undefined;
      do {
        const params = new URLSearchParams({
          action: "query",
          format: "json",
          formatversion: "2",
          prop: "extracts|pageimages|pageprops|info",
          inprop: "url",
          ppprop: "disambiguation",
          exintro: "1",
          explaintext: "1",
          exlimit: "max",
          piprop: "thumbnail",
          pithumbsize: "320",
          pilimit: "max",
          redirects: "1",
          titles: group.join("|"),
          ...(cont ?? {}),
        });
        const json = await apiQuery(params);
        for (const n of json.query?.normalized ?? []) norm.set(n.from, n.to);
        for (const r of json.query?.redirects ?? []) redir.set(r.from, r.to);
        for (const p of json.query?.pages ?? []) {
          const prev = byFinal.get(p.title);
          if (!prev) {
            byFinal.set(p.title, { ...p });
          } else {
            prev.extract ??= p.extract;
            prev.thumbnail ??= p.thumbnail;
            prev.fullurl ??= p.fullurl;
            prev.pageprops ??= p.pageprops;
            prev.missing ??= p.missing;
          }
        }
        cont = json.continue;
      } while (cont);

      for (const t of group) {
        let final = norm.get(t) ?? t;
        for (let hop = 0; hop < 5 && redir.has(final); hop++) final = redir.get(final)!;
        const p = byFinal.get(final);
        if (!p || p.missing) {
          cache[t] = { ok: false };
          continue;
        }
        cache[t] = {
          ok: true,
          title: p.title,
          extract: p.extract,
          thumbnail: p.thumbnail?.source,
          url:
            p.fullurl ??
            `https://en.wikipedia.org/wiki/${encodeURIComponent(p.title.replace(/ /g, "_"))}`,
          disambiguation: !!p.pageprops && "disambiguation" in p.pageprops,
        };
      }

      done++;
      if (done % 10 === 0 || done === groups.length) {
        persist();
        console.log(`  ${Math.min(done * BATCH_SIZE, need.length)}/${need.length} titles fetched`);
      }
      await sleep(BATCH_DELAY_MS);
    }
  }

  const usable = (s: Summary | undefined): s is Summary & { extract: string } =>
    !!s?.ok && !!s.extract && !s.disambiguation;

  // ---- 1. Nodes with a known article url -----------------------------------
  const withUrl = await db
    .select({ id: schema.nodes.id, url: schema.nodes.wikipediaUrl })
    .from(schema.nodes)
    .where(isNotNull(schema.nodes.wikipediaUrl));
  console.log(`${withUrl.length} nodes with known Wikipedia articles`);

  await fetchBatch(withUrl.map((n) => titleFromUrl(n.url!)));

  let updated = 0;
  for (const n of withUrl) {
    const s = cache[titleFromUrl(n.url!)];
    if (usable(s)) {
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
  }
  console.log(`Updated ${updated} nodes from known articles`);

  // ---- 2. Grand branches (hand-picked articles) ------------------------------
  await fetchBatch(Object.values(BRANCH_ARTICLES));
  for (const [nodeId, article] of Object.entries(BRANCH_ARTICLES)) {
    const s = cache[article];
    if (s?.ok) {
      await db
        .update(schema.nodes)
        .set({ thumbnailUrl: s.thumbnail ?? null, wikipediaUrl: s.url ?? null })
        .where(eq(schema.nodes.id, nodeId));
    }
  }
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

  // MSC titles are often lists ("Sequences, series, summability") — try the
  // full title first, then the first comma/semicolon-separated segment.
  const attemptsFor = (title: string): string[] => {
    const full = title.trim();
    const seg = title.split(/[;,]/)[0].trim();
    return [...new Set([full, seg])].filter((t) => t.length > 3);
  };

  await fetchBatch(candidates.map((n) => attemptsFor(n.title)[0]).filter(Boolean));
  const secondary = candidates
    .filter((n) => !usable(cache[attemptsFor(n.title)[0]]))
    .flatMap((n) => attemptsFor(n.title).slice(1));
  await fetchBatch(secondary);

  let found = 0;
  for (const n of candidates) {
    for (const t of attemptsFor(n.title)) {
      const s = cache[t];
      if (usable(s)) {
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
  }
  persist();
  console.log(`Found articles for ${found} additional fields/subfields`);
  console.log("Wikipedia ingestion complete.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
