/**
 * Live arXiv Atom API client — search papers related to a map node.
 * https://info.arxiv.org/help/api/user-manual.html
 */

export interface ArxivPaper {
  id: string;
  title: string;
  summary: string;
  authors: string[];
  published: string; // ISO date
  updated: string;
  absUrl: string;
  pdfUrl: string;
  primaryCategory: string | null;
  categories: string[];
}

export interface ArxivSearchResult {
  query: string;
  total: number;
  papers: ArxivPaper[];
  searchUrl: string;
}

const API = "https://export.arxiv.org/api/query";
const USER_AGENT =
  "MathMap/0.2 (personal project; https://github.com/ShalyJay/A-Complete-Map-of-Mathematics)";

/** In-process cache so reopening a node does not re-hammer arXiv. */
const cache = new Map<string, { at: number; value: ArxivSearchResult }>();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

const ENTITY_TYPES = new Set([
  "concept",
  "theorem",
  "axiom",
  "conjecture",
  "definition",
]);

/** Strip MSC-style parentheticals, TeX, and excess punctuation for search. */
export function cleanSearchTitle(title: string): string {
  return title
    .replace(/\$[^$]*\$/g, " ")
    .replace(/\\\([^)]*\\\)/g, " ")
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .replace(/[_^]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface ArxivScope {
  domain?: "math" | "physics" | "cs";
  /** the vault's arXiv category for the node (e.g. "hep-th", "cs.LG"), when it has one */
  arxiv?: string | null;
}

const DOMAIN_CATS: Record<string, string> = {
  math: "(cat:math* OR cat:cs.CC OR cat:cs.LO OR cat:cs.DM OR cat:stat.TH OR cat:stat.ML)",
  physics:
    "(cat:physics* OR cat:hep-th OR cat:hep-ph OR cat:hep-ex OR cat:hep-lat OR cat:gr-qc OR cat:quant-ph OR cat:cond-mat* OR cat:astro-ph* OR cat:nucl-th OR cat:nucl-ex OR cat:math-ph OR cat:nlin*)",
  cs: "(cat:cs* OR cat:stat.ML)",
};

/** arXiv category filter: the node's own category when the vault records one, else its domain's. */
export function categoryFilter(scope: ArxivScope = {}): string {
  const own = (scope.arxiv ?? "")
    .split(/[,\s]+/)
    .map((c) => c.trim())
    .filter((c) => /^[a-z-]+(\.[A-Za-z-]+)?$/.test(c));
  if (own.length) return `(${own.map((c) => `cat:${c}`).join(" OR ")})`;
  return DOMAIN_CATS[scope.domain ?? "math"];
}

/**
 * Build an arXiv search_query for a map node.
 * Concepts and named results get a tight phrase match; taxonomy nodes get a broader all: search,
 * both scoped to the node's arXiv category or its domain's categories.
 */
export function buildArxivQuery(title: string, type: string, scope: ArxivScope = {}): string | null {
  const cleaned = cleanSearchTitle(title);
  if (cleaned.length < 3) return null;
  // Skip roots and grand branches — results would be noise.
  if (type === "branch" || type === "domain") return null;

  const phrase = cleaned.replace(/"/g, "");
  const cats = categoryFilter(scope);

  if (ENTITY_TYPES.has(type)) {
    return `(ti:"${phrase}" OR abs:"${phrase}") AND ${cats}`;
  }

  // MSC taxonomy titles are long and bureaucratic ("…pertaining to…").
  // Prefer an AND of a few content words over one exact mega-phrase.
  const stop = new Set([
    "and",
    "or",
    "of",
    "the",
    "a",
    "an",
    "in",
    "on",
    "for",
    "to",
    "with",
    "without",
    "etc",
    "aspects",
    "pertaining",
    "including",
    "related",
    "other",
    "general",
    "properties",
    "problems",
    "theory",
    "topics",
    "methods",
    "works",
    "overarching",
    "collections",
  ]);
  const words = phrase
    .split(/\s+/)
    .map((w) => w.replace(/[^a-zA-Z0-9\-]/g, ""))
    .filter((w) => w.length > 3 && !stop.has(w.toLowerCase()));
  const terms = words.slice(0, 4).map((w) => `all:${w}`);
  if (terms.length >= 2) {
    return `(${terms.join(" AND ")}) AND ${cats}`;
  }
  return `all:"${phrase}" AND ${cats}`;
}

export function arxivWebSearchUrl(query: string): string {
  return `https://arxiv.org/search/?query=${encodeURIComponent(query)}&searchtype=all&source=all`;
}

function textOf(block: string, tag: string): string {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  return m ? decodeXml(m[1].trim()) : "";
}

function decodeXml(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function parseEntry(block: string): ArxivPaper | null {
  const idUrl = textOf(block, "id");
  if (!idUrl) return null;
  // http://arxiv.org/abs/0906.4155v7 → 0906.4155
  const idMatch = idUrl.match(/arxiv\.org\/abs\/(.+?)(?:v\d+)?$/i);
  const id = idMatch ? idMatch[1] : idUrl;

  const title = textOf(block, "title");
  const summary = textOf(block, "summary");
  const published = textOf(block, "published");
  const updated = textOf(block, "updated");

  const authors: string[] = [];
  for (const am of block.matchAll(/<author>\s*<name>([\s\S]*?)<\/name>/gi)) {
    authors.push(decodeXml(am[1]));
  }

  const categories: string[] = [];
  for (const cm of block.matchAll(/<category[^>]*term="([^"]+)"/gi)) {
    categories.push(cm[1]);
  }
  const primary =
    block.match(/<arxiv:primary_category[^>]*term="([^"]+)"/i)?.[1] ??
    categories[0] ??
    null;

  let absUrl = `https://arxiv.org/abs/${id}`;
  let pdfUrl = `https://arxiv.org/pdf/${id}`;
  const absLink = block.match(
    /<link[^>]*rel="alternate"[^>]*href="([^"]+)"/i,
  )?.[1];
  const pdfLink = block.match(
    /<link[^>]*title="pdf"[^>]*href="([^"]+)"/i,
  )?.[1];
  if (absLink) absUrl = absLink.replace(/^http:/, "https:");
  if (pdfLink) pdfUrl = pdfLink.replace(/^http:/, "https:");

  return {
    id,
    title,
    summary,
    authors,
    published,
    updated,
    absUrl,
    pdfUrl,
    primaryCategory: primary,
    categories,
  };
}

function parseAtom(xml: string, query: string): ArxivSearchResult {
  const total = Number(
    xml.match(/<opensearch:totalResults>(\d+)<\/opensearch:totalResults>/)?.[1] ??
      0,
  );
  const papers: ArxivPaper[] = [];
  for (const m of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const paper = parseEntry(m[1]);
    if (paper) papers.push(paper);
  }
  return {
    query,
    total,
    papers,
    searchUrl: arxivWebSearchUrl(cleanSearchTitle(query.replace(/[()]/g, " "))),
  };
}

export async function searchArxiv(opts: {
  title: string;
  type: string;
  scope?: ArxivScope;
  maxResults?: number;
}): Promise<ArxivSearchResult | null> {
  const query = buildArxivQuery(opts.title, opts.type, opts.scope);
  if (!query) return null;

  const maxResults = Math.min(Math.max(opts.maxResults ?? 8, 1), 20);
  const cacheKey = `${query}::${maxResults}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

  // Over-fetch so we can demote low-signal categories and still fill the list.
  const fetchCount = Math.min(maxResults * 3, 30);
  const params = new URLSearchParams({
    search_query: query,
    start: "0",
    max_results: String(fetchCount),
    sortBy: "relevance",
    sortOrder: "descending",
  });

  const res = await fetch(`${API}?${params}`, {
    headers: {
      Accept: "application/atom+xml",
      "User-Agent": USER_AGENT,
    },
    // Avoid Next fetching forever if arXiv is slow
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) {
    throw new Error(`arXiv API ${res.status}: ${await res.text()}`);
  }
  const xml = await res.text();
  const result = parseAtom(xml, query);
  // Friendlier browse link: use the cleaned title, not the Lucene query.
  result.searchUrl = arxivWebSearchUrl(cleanSearchTitle(opts.title));

  // Prefer non-math.GM primaries: for famous named results that category is
  // dominated by unverified "proofs". Keep GM papers only as filler.
  const preferred = result.papers.filter((p) => p.primaryCategory !== "math.GM");
  const demoted = result.papers.filter((p) => p.primaryCategory === "math.GM");
  result.papers = [...preferred, ...demoted].slice(0, maxResults);

  cache.set(cacheKey, { at: Date.now(), value: result });
  return result;
}
