/**
 * Ingest theorems, axioms, conjectures (and lemmas) from Wikidata and attach
 * them as leaf nodes (depth 4) under the MSC tree. Also enrich existing MSC
 * nodes with Wikidata QIDs + Wikipedia URLs where an item carries an MSC code
 * (property P3285).
 *
 * Attachment strategy, in priority order:
 *   1. The item's own MSC code (P3285).
 *   2. A field link (P361 part-of | P1269 facet-of | P2579 studied-by |
 *      P101 field-of-work) to an item that has an MSC code.
 *   3. English Wikipedia categories ("Theorems in number theory" ->
 *      MSC 11-XX) matched against MSC field/subfield titles + an alias map.
 *
 * Uses the QLever Wikidata SPARQL endpoint (fast mirror of Wikidata; the
 * official WDQS endpoint frequently times out on these queries).
 *
 * Usage: npm run ingest:wikidata   (run ingest:msc first)
 */
import fs from "node:fs";
import path from "node:path";
import { like, or, sql, inArray } from "drizzle-orm";
import { getDb, schema } from "../src/db/index";
import { chunk, mapWithConcurrency, sleep } from "./lib";

const SPARQL_ENDPOINT = "https://qlever.dev/api/wikidata";
const CACHE_DIR = path.join(process.cwd(), "data", "cache");
const USER_AGENT = "MathMapIngest/0.1 (personal project; map of mathematics)";

const CLASSES: { qid: string; type: string }[] = [
  { qid: "Q65943", type: "theorem" },
  { qid: "Q207505", type: "theorem" }, // lemma
  { qid: "Q17736", type: "axiom" },
  { qid: "Q319141", type: "conjecture" },
];

/** Common field names appearing in Wikipedia categories -> MSC code. */
const FIELD_ALIASES: Record<string, string> = {
  "number theory": "11-XX",
  "analytic number theory": "11Mxx",
  "algebraic number theory": "11Rxx",
  "real analysis": "26-XX",
  calculus: "26-XX",
  "mathematical analysis": "26-XX",
  "complex analysis": "30-XX",
  "functional analysis": "46-XX",
  "harmonic analysis": "42-XX",
  "fourier analysis": "42-XX",
  "measure theory": "28-XX",
  "approximation theory": "41-XX",
  "operator theory": "47-XX",
  "potential theory": "31-XX",
  "differential equations": "34-XX",
  "ordinary differential equations": "34-XX",
  "partial differential equations": "35-XX",
  "dynamical systems": "37-XX",
  "calculus of variations": "49-XX",
  algebra: "08-XX",
  "abstract algebra": "08-XX",
  "linear algebra": "15-XX",
  "group theory": "20-XX",
  "ring theory": "16-XX",
  "commutative algebra": "13-XX",
  "field theory": "12-XX",
  "galois theory": "12Fxx",
  "category theory": "18-XX",
  "homological algebra": "18Gxx",
  "representation theory": "20Cxx",
  "lattice theory": "06-XX",
  "order theory": "06-XX",
  "lie groups": "22Exx",
  "lie algebras": "17Bxx",
  "k-theory": "19-XX",
  geometry: "51-XX",
  "euclidean geometry": "51Mxx",
  "plane geometry": "51Mxx",
  "projective geometry": "51Axx",
  "algebraic geometry": "14-XX",
  "differential geometry": "53-XX",
  "riemannian geometry": "53Bxx",
  "convex geometry": "52-XX",
  "discrete geometry": "52Cxx",
  "incidence geometry": "51-XX",
  trigonometry: "51Mxx",
  "triangle geometry": "51Mxx",
  topology: "54-XX",
  "general topology": "54-XX",
  "algebraic topology": "55-XX",
  "differential topology": "57Rxx",
  "geometric topology": "57-XX",
  "knot theory": "57K10",
  "manifold theory": "57-XX",
  manifolds: "57-XX",
  "mathematical logic": "03-XX",
  logic: "03-XX",
  "set theory": "03Exx",
  "model theory": "03Cxx",
  "proof theory": "03Fxx",
  "computability theory": "03Dxx",
  "recursion theory": "03Dxx",
  "foundations of mathematics": "03-XX",
  combinatorics: "05-XX",
  "graph theory": "05Cxx",
  "extremal graph theory": "05Cxx",
  "ramsey theory": "05Dxx",
  "enumerative combinatorics": "05Axx",
  // Physics and computer science sections are excluded from the map, so no
  // aliases target 68/94/70-86; cryptography maps to its number-theory home.
  cryptography: "11T71",
  "probability theory": "60-XX",
  probability: "60-XX",
  statistics: "62-XX",
  "stochastic processes": "60Gxx",
  "game theory": "91Axx",
  "decision theory": "91Bxx",
  economics: "91Bxx",
  "mathematical economics": "91Bxx",
  "operations research": "90-XX",
  optimization: "90Cxx",
  "mathematical optimization": "90Cxx",
  "control theory": "93-XX",
  "numerical analysis": "65-XX",
  "fixed points (mathematics)": "47H10",
  "fixed-point theorems": "47H10",
  "inequalities (mathematics)": "26Dxx",
  "theorems in propositional logic": "03Bxx",
};

interface SparqlBinding {
  [k: string]: { value: string } | undefined;
}

async function sparql(query: string, cacheKey: string): Promise<SparqlBinding[]> {
  const cachePath = path.join(CACHE_DIR, `${cacheKey}.json`);
  if (fs.existsSync(cachePath)) {
    return JSON.parse(fs.readFileSync(cachePath, "utf8"));
  }
  const prefixes = `
    PREFIX wd: <http://www.wikidata.org/entity/>
    PREFIX wdt: <http://www.wikidata.org/prop/direct/>
    PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
    PREFIX schema: <http://schema.org/>
  `;
  const url = `${SPARQL_ENDPOINT}?query=${encodeURIComponent(prefixes + query)}`;
  const res = await fetch(url, {
    headers: {
      Accept: "application/sparql-results+json",
      "User-Agent": USER_AGENT,
    },
  });
  if (!res.ok) throw new Error(`SPARQL failed (${res.status}): ${await res.text()}`);
  const json = (await res.json()) as { results: { bindings: SparqlBinding[] } };
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(cachePath, JSON.stringify(json.results.bindings));
  return json.results.bindings;
}

const qidOf = (uri: string) => uri.replace(/^.*\//, "");

function normalizeTitle(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s()-]/g, "").replace(/\s+/g, " ").trim();
}

/** Fetch categories for enwiki article titles, 50 per API call, with caching. */
async function fetchCategories(titles: string[]): Promise<Map<string, string[]>> {
  const cachePath = path.join(CACHE_DIR, "enwiki-categories.json");
  const cache: Record<string, string[]> = fs.existsSync(cachePath)
    ? JSON.parse(fs.readFileSync(cachePath, "utf8"))
    : {};
  const missing = titles.filter((t) => !(t in cache));
  console.log(`Fetching categories for ${missing.length} articles (${titles.length - missing.length} cached)`);

  const batches = chunk(missing, 50);
  let done = 0;
  await mapWithConcurrency(batches, 1, async (batch) => {
    const params = new URLSearchParams({
      action: "query",
      prop: "categories",
      titles: batch.join("|"),
      cllimit: "max",
      clshow: "!hidden",
      redirects: "1",
      format: "json",
    });
    let res: Response | undefined;
    for (let attempt = 0; attempt < 5; attempt++) {
      res = await fetch(`https://en.wikipedia.org/w/api.php?${params}`, {
        headers: { "User-Agent": USER_AGENT },
      });
      if (res.status !== 429) break;
      const wait = 2000 * 2 ** attempt;
      console.warn(`  rate limited, retrying in ${wait}ms`);
      await sleep(wait);
    }
    if (!res || !res.ok) {
      console.warn(`Category batch failed: ${res?.status}`);
      return;
    }
    const json = (await res.json()) as {
      query?: {
        redirects?: { from: string; to: string }[];
        pages?: Record<string, { title: string; categories?: { title: string }[] }>;
      };
    };
    const redirectBack = new Map<string, string>();
    for (const r of json.query?.redirects ?? []) redirectBack.set(r.to, r.from);
    for (const page of Object.values(json.query?.pages ?? {})) {
      const cats = (page.categories ?? []).map((c) => c.title.replace(/^Category:/, ""));
      const original = redirectBack.get(page.title) ?? page.title;
      cache[original] = cats;
      if (original !== page.title) cache[page.title] = cats;
    }
    for (const t of batch) if (!(t in cache)) cache[t] = [];
    done++;
    if (done % 10 === 0) console.log(`  ${done}/${batches.length} category batches`);
    await sleep(100);
  });
  fs.writeFileSync(cachePath, JSON.stringify(cache));
  return new Map(titles.map((t) => [t, cache[t] ?? []]));
}

async function main() {
  const db = await getDb();

  // ---- Load existing MSC nodes for code + title matching -------------------
  const mscNodes = await db
    .select({
      id: schema.nodes.id,
      mscCode: schema.nodes.mscCode,
      title: schema.nodes.title,
      type: schema.nodes.type,
    })
    .from(schema.nodes)
    .where(like(schema.nodes.id, "msc:%"));
  if (mscNodes.length === 0) {
    throw new Error("No MSC nodes found — run `npm run ingest:msc` first.");
  }
  const byCode = new Map(mscNodes.map((n) => [n.mscCode!, n]));
  const titleToCode = new Map<string, string>();
  for (const n of mscNodes) {
    if (n.type === "field" || n.type === "subfield") {
      titleToCode.set(normalizeTitle(n.title), n.mscCode!);
    }
  }

  /** Normalize a Wikidata / category-derived MSC code to an existing node id. */
  function resolveMsc(code: string): string | null {
    const c = code.trim();
    const candidates = [
      c,
      c.toUpperCase(),
      `${c}-XX`, // "11" -> "11-XX"
      c.length >= 3 ? `${c.slice(0, 3)}xx` : "",
      c.length >= 2 ? `${c.slice(0, 2)}-XX` : "",
    ];
    for (const cand of candidates) {
      if (cand && byCode.has(cand)) return byCode.get(cand)!.id;
    }
    return null;
  }

  /** Map a Wikipedia category title to an MSC node id, or null. */
  function categoryToMsc(cat: string): string | null {
    // "Theorems in number theory", "Conjectures about primes", "Lemmas in analysis"
    const m = cat.match(
      /^(?:theorems?|lemmas?|conjectures?|axioms?|identities|inequalities|unsolved problems|equations)\s+(?:in|of|about|involving)\s+(.+)$/i,
    );
    const raw = m ? m[1] : cat;
    const norm = normalizeTitle(raw);
    const viaAlias = FIELD_ALIASES[norm];
    if (viaAlias) return resolveMsc(viaAlias);
    const viaTitle = titleToCode.get(norm);
    if (viaTitle) return resolveMsc(viaTitle);
    // whole category as alias ("Fixed-point theorems")
    const whole = FIELD_ALIASES[normalizeTitle(cat)];
    if (whole) return resolveMsc(whole);
    return null;
  }

  // ---- Query 1: all items carrying an MSC code (P3285) ---------------------
  console.log("Querying Wikidata (QLever) for MSC-coded items...");
  const mscItems = await sparql(
    `SELECT ?item ?label ?desc ?msc ?article WHERE {
      ?item wdt:P3285 ?msc .
      ?item rdfs:label ?label . FILTER(LANG(?label) = "en")
      OPTIONAL { ?item schema:description ?desc . FILTER(LANG(?desc) = "en") }
      OPTIONAL { ?article schema:about ?item . ?article schema:isPartOf <https://en.wikipedia.org/> }
    }`,
    "wd-msc-items",
  );
  console.log(`  ${mscItems.length} MSC-coded item rows`);

  // ---- Query 2: theorem-like entities ---------------------------------------
  // One query per class: combining classes via VALUES + P279* closure forces a
  // catastrophic query plan on QLever (>30s timeout); per-class runs in ~3s.
  const entities: Array<SparqlBinding & { __class: string }> = [];
  const fieldLinks: SparqlBinding[] = [];
  const depLinks: SparqlBinding[] = [];
  for (const cls of CLASSES) {
    const rows = await sparql(
      `SELECT DISTINCT ?item ?label ?desc ?msc ?article WHERE {
        ?item wdt:P31/wdt:P279* wd:${cls.qid} .
        ?item @en@rdfs:label ?label .
        OPTIONAL { ?item @en@schema:description ?desc }
        OPTIONAL { ?item wdt:P3285 ?msc }
        OPTIONAL { ?article schema:about ?item . ?article schema:isPartOf <https://en.wikipedia.org/> }
      }`,
      `wd-entities-${cls.qid}`,
    );
    for (const r of rows) {
      entities.push(Object.assign({}, r, { __class: cls.qid }));
    }
    const links = await sparql(
      `SELECT DISTINCT ?item ?fieldMsc WHERE {
        ?item wdt:P31/wdt:P279* wd:${cls.qid} .
        ?item ?p ?f . VALUES ?p { wdt:P361 wdt:P1269 wdt:P2579 wdt:P101 }
        ?f wdt:P3285 ?fieldMsc .
      }`,
      `wd-field-links-${cls.qid}`,
    );
    fieldLinks.push(...links);
    // Derivation links: "this theorem is inferred from / based on / uses that
    // theorem or axiom" — the raw material for the progressive layout.
    const deps = await sparql(
      `SELECT DISTINCT ?item ?dep WHERE {
        ?item wdt:P31/wdt:P279* wd:${cls.qid} .
        ?item ?p ?dep . VALUES ?p { wdt:P3452 wdt:P144 wdt:P737 wdt:P2283 }
      }`,
      `wd-deps-${cls.qid}`,
    );
    depLinks.push(...deps);
    console.log(
      `  ${cls.qid} (${cls.type}): ${rows.length} rows, ${links.length} field links, ${deps.length} dependency links`,
    );
  }

  // ---- Aggregate entity rows by item ----------------------------------------
  interface Entity {
    qid: string;
    label: string;
    desc?: string;
    type: string;
    mscCodes: Set<string>;
    fieldCodes: Set<string>;
    article?: string;
  }
  const typeByClass = new Map(CLASSES.map((c) => [c.qid, c.type]));
  // axiom > theorem: "axiom" sits inside the theorem subclass closure on
  // Wikidata, so axioms also match the theorem query and must win the tie.
  const typePriority: Record<string, number> = { axiom: 4, theorem: 3, conjecture: 2 };
  const entMap = new Map<string, Entity>();
  for (const b of entities) {
    const qid = qidOf(b.item!.value);
    let e = entMap.get(qid);
    if (!e) {
      e = {
        qid,
        label: b.label!.value,
        desc: b.desc?.value,
        type: "theorem",
        mscCodes: new Set(),
        fieldCodes: new Set(),
      };
      e.type = typeByClass.get(b.__class) ?? "theorem";
      entMap.set(qid, e);
    } else {
      const t = typeByClass.get(b.__class) ?? "theorem";
      if ((typePriority[t] ?? 0) > (typePriority[e.type] ?? 0)) e.type = t;
    }
    if (b.msc) e.mscCodes.add(b.msc.value);
    if (b.article) e.article = decodeURIComponent(b.article.value);
  }
  for (const b of fieldLinks) {
    const e = entMap.get(qidOf(b.item!.value));
    if (e && b.fieldMsc) e.fieldCodes.add(b.fieldMsc.value);
  }
  console.log(`  ${entMap.size} distinct entities`);

  // ---- Category-based attachment for entities without MSC links -------------
  const needCats: Entity[] = [];
  for (const e of entMap.values()) {
    const hasDirect = [...e.mscCodes].some((c) => resolveMsc(c));
    const hasField = [...e.fieldCodes].some((c) => resolveMsc(c));
    if (!hasDirect && !hasField && e.article) needCats.push(e);
  }
  const titleOf = (article: string) =>
    decodeURIComponent(article.replace("https://en.wikipedia.org/wiki/", "")).replace(/_/g, " ");
  const catMap = await fetchCategories(needCats.map((e) => titleOf(e.article!)));

  // ---- Build node + edge rows ------------------------------------------------
  type NodeRow = typeof schema.nodes.$inferInsert;
  type EdgeRow = typeof schema.edges.$inferInsert;
  const nodeRows: NodeRow[] = [];
  const edgeRows: EdgeRow[] = [];
  let attachedDirect = 0,
    attachedField = 0,
    attachedCat = 0,
    unattached = 0;

  const entityQids = new Set(entMap.keys());

  for (const e of entMap.values()) {
    const parents = new Set<string>();
    for (const c of e.mscCodes) {
      const id = resolveMsc(c);
      if (id) parents.add(id);
    }
    const directCount = parents.size;
    if (parents.size === 0) {
      for (const c of e.fieldCodes) {
        const id = resolveMsc(c);
        if (id) parents.add(id);
      }
      if (parents.size > 0) attachedField++;
    } else {
      attachedDirect++;
    }
    if (parents.size === 0 && e.article) {
      for (const cat of catMap.get(titleOf(e.article)) ?? []) {
        const id = categoryToMsc(cat);
        if (id) parents.add(id);
      }
      if (parents.size > 0) attachedCat++;
    }
    if (parents.size === 0) {
      unattached++;
      continue;
    }
    void directCount;

    const [primary, ...rest] = [...parents];
    const id = `wd:${e.qid}`;
    nodeRows.push({
      id,
      wikidataQid: e.qid,
      type: e.type,
      title: e.label,
      summary: e.desc ?? null,
      wikipediaUrl: e.article ?? null,
      depth: 4,
      parentId: primary,
    });
    edgeRows.push({ source: id, target: primary, type: "child-of" });
    for (const p of rest) edgeRows.push({ source: id, target: p, type: "related" });
  }

  console.log(
    `Attachment: ${attachedDirect} direct MSC, ${attachedField} via field link, ${attachedCat} via categories, ${unattached} unattached (skipped)`,
  );

  // ---- Dependency edges between attached entities ----------------------------
  // source = the dependent result, target = its prerequisite (axiom/theorem).
  const insertedIds = new Set(nodeRows.map((n) => n.id));
  const depPairs = new Set<string>();
  for (const b of depLinks) {
    if (!b.item || !b.dep) continue;
    const src = `wd:${qidOf(b.item.value)}`;
    const tgt = `wd:${qidOf(b.dep.value)}`;
    if (src === tgt) continue;
    if (!insertedIds.has(src) || !insertedIds.has(tgt)) continue;
    depPairs.add(`${src} ${tgt}`);
  }
  for (const pair of depPairs) {
    const [source, target] = pair.split(" ");
    edgeRows.push({ source, target, type: "depends-on" });
  }
  console.log(`Dependency edges between attached entities: ${depPairs.size}`);

  // ---- Enrich MSC nodes with QIDs / Wikipedia URLs ---------------------------
  const enrich = new Map<string, { qid: string; article?: string; desc?: string }>();
  for (const b of mscItems) {
    const qid = qidOf(b.item!.value);
    if (entityQids.has(qid)) continue; // it's a leaf entity, not a field
    const nodeId = resolveMsc(b.msc!.value);
    if (!nodeId) continue;
    const existing = enrich.get(nodeId);
    const article = b.article ? decodeURIComponent(b.article.value) : undefined;
    if (!existing || (!existing.article && article)) {
      enrich.set(nodeId, { qid, article, desc: b.desc?.value });
    }
  }

  // ---- Write to DB -------------------------------------------------------------
  console.log(`Writing ${nodeRows.length} entity nodes, ${edgeRows.length} edges, ${enrich.size} MSC enrichments...`);
  const wdIds = nodeRows.map((n) => n.id);
  if (wdIds.length > 0) {
    for (const batch of chunk(wdIds, 1000)) {
      await db.delete(schema.edges).where(
        or(inArray(schema.edges.source, batch), inArray(schema.edges.target, batch)),
      );
    }
  }
  await db.delete(schema.nodes).where(like(schema.nodes.id, "wd:%"));

  for (const batch of chunk(nodeRows, 500)) {
    await db.insert(schema.nodes).values(batch);
  }
  for (const batch of chunk(edgeRows, 500)) {
    await db.insert(schema.edges).values(batch);
  }
  for (const [nodeId, info] of enrich) {
    await db
      .update(schema.nodes)
      .set({ wikidataQid: info.qid, wikipediaUrl: info.article ?? null })
      .where(sql`${schema.nodes.id} = ${nodeId}`);
  }

  const counts = await db.execute(
    sql`select type, count(*)::int as n from nodes group by type order by n desc`,
  );
  console.log("Node counts by type:", counts);
  console.log("Wikidata ingestion complete.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
