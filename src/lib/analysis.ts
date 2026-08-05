import Anthropic from "@anthropic-ai/sdk";
import { eq, inArray } from "drizzle-orm";
import { getDb, schema, type Db } from "@/db";
import { extractPhrases } from "@/lib/nlp/phrases";
import { cosine, embedTexts, ensureNodeIndex } from "@/lib/nlp/embeddings";

export interface Classification {
  /** MSC code (LLM path) — resolved to a node id when storing */
  code?: string;
  /** Direct node id (keyword / local path) */
  nodeId?: string;
  weight: number;
  rationale: string;
}

export type AnalysisMethod = "keyword" | "llm";

const MAX_DOC_CHARS = 60_000;
/** Minimum cosine similarity to keep an embedding hit. */
const SEM_FLOOR = 0.38;
/** How many top embedding neighbors to keep before fusion. */
const SEM_TOP_K = 25;

// ---------------------------------------------------------------------------
// Keyword matching (default — no API key required)
// ---------------------------------------------------------------------------

/** Single words too generic to be a useful signal on their own. */
const GENERIC_WORDS = new Set([
  "general",
  "theory",
  "theories",
  "methods",
  "method",
  "applications",
  "application",
  "equations",
  "equation",
  "functions",
  "function",
  "problems",
  "problem",
  "spaces",
  "space",
  "models",
  "model",
  "systems",
  "system",
  "operators",
  "operator",
  "structures",
  "structure",
  "properties",
  "solutions",
  "numerical",
  "mathematical",
  "special",
  "explicit",
  "abstract",
  "classical",
  "elementary",
  "advanced",
  "results",
  "questions",
  "relations",
  "processes",
  "process",
  "simple",
  "integral",
  "integrals",
  "series",
  "existence",
  "uniqueness",
  "stability",
  "approximation",
  "representation",
  "generalizations",
  "extensions",
  "inequalities",
  "identities",
  "examples",
  "computation",
]);

/** Whole titles that are organizational noise in MSC. */
const STOP_TITLES =
  /^(general|miscellaneous|other|none of the above|research exposition|history|instructional exposition|proceedings|conferences|collections|software|textbooks?|monographs?)\b/i;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Extract matchable phrases from a node title. */
function phrasesFor(title: string, type: string): string[] {
  // Entity names ("Fermat's Last Theorem") are high-signal — match whole.
  if (["theorem", "axiom", "conjecture", "definition"].includes(type)) {
    const t = title.trim().toLowerCase();
    return t.length >= 8 ? [t] : [];
  }
  // MSC titles are often lists: "Sequences, series, summability" or
  // "Group theory and generalizations".
  const cleaned = title.replace(/\([^)]*\)/g, " ").trim();
  return cleaned
    .split(/[;,:]|\band\b/)
    .map((s) => s.trim().toLowerCase())
    .filter((p) => {
      if (p.length < 5 || STOP_TITLES.test(p)) return false;
      const words = p.split(/\s+/);
      if (words.length === 1) {
        if (p.length < 6 || GENERIC_WORDS.has(p)) return false;
        // A lone word is only a reliable signal when it essentially IS the
        // title ("Primes", "Combinatorics") — not a fragment of a longer one.
        if (p.length < cleaned.length * 0.8) return false;
      }
      return true;
    });
}

/** Phrase → regex with light plural/singular tolerance on the last word. */
function phraseRegex(phrase: string): RegExp {
  let source = escapeRegExp(phrase);
  if (/[a-z]{4}s$/.test(phrase) && !/ss$/.test(phrase)) {
    source = source.replace(/s$/, "s?"); // "primes" also matches "prime"
  } else if (/[a-z]{4}$/.test(phrase)) {
    source = `${source}s?`; // "markov chain" also matches "markov chains"
  }
  return new RegExp(`\\b${source}\\b`, "g");
}

const LEVEL_BOOST: Record<string, number> = {
  field: 0.7,
  subfield: 1.0,
  topic: 1.25,
  theorem: 1.6,
  axiom: 1.6,
  conjecture: 1.6,
  definition: 1.4,
};

function educationPenalty(id: string, title: string): number {
  return /educational aspects|education of|^msc:97/i.test(`${title} ${id}`) ? 0.25 : 1;
}

/**
 * Local offline classification: compromise noun-phrase extraction + tiny
 * MiniLM embeddings against the taxonomy (and named results). Replaces naive
 * whole-document keyword scans that misfire on "prime" / "strings".
 */
export async function classifyByKeywords(text: string): Promise<Classification[]> {
  const db = await getDb();
  const rows = await db
    .select({
      id: schema.nodes.id,
      title: schema.nodes.title,
      type: schema.nodes.type,
    })
    .from(schema.nodes)
    .where(
      inArray(schema.nodes.type, [
        "field",
        "subfield",
        "topic",
        "theorem",
        "axiom",
        "conjecture",
        "definition",
      ]),
    );

  const clipped = text.slice(0, MAX_DOC_CHARS).replace(/\s+/g, " ");
  const docLower = ` ${clipped.toLowerCase()} `;
  const { phrases, counts } = extractPhrases(clipped);

  // ---- Lexical: match extracted phrases (and entity titles) against nodes ----
  const lexical = new Map<string, { score: number; rationale: string; phrase: string }>();
  const phraseList = phrases.length > 0 ? phrases : [];

  const containsPhrase = (hay: string, needle: string): boolean => {
    if (hay === needle) return true;
    // Whole-phrase containment only (avoid "prime number" ⊂ "prime number theorem").
    try {
      return new RegExp(`(?:^|\\s)${escapeRegExp(needle)}(?:\\s|$)`).test(hay);
    } catch {
      return false;
    }
  };

  for (const n of rows) {
    let bestScore = 0;
    let bestPhrase = "";
    let bestCount = 0;
    const candidates = phrasesFor(n.title, n.type);
    for (const phrase of candidates) {
      // Prefer counting inside extracted noun phrases (syntax-aware), fall
      // back to whole-doc only for multiword / entity titles.
      let count = 0;
      for (const p of phraseList) {
        if (containsPhrase(p, phrase)) count += counts.get(p) ?? 1;
      }
      if (
        count === 0 &&
        (phrase.includes(" ") ||
          ["theorem", "axiom", "conjecture", "definition"].includes(n.type))
      ) {
        count = (docLower.match(phraseRegex(phrase)) ?? []).length;
      }
      if (count === 0) continue;
      // Single-word / short title fragments on education mirrors stay weak.
      if (n.id.startsWith("msc:97") && phrase.split(/\s+/).length < 3) continue;
      const specificity = 0.6 + Math.min(phrase.length / 14, 1.4);
      const titleFit = 0.7 + 0.3 * Math.min(1, phrase.length / Math.max(n.title.length, 1));
      const score =
        (1 + Math.log2(count)) *
        specificity *
        titleFit *
        (LEVEL_BOOST[n.type] ?? 1) *
        educationPenalty(n.id, n.title);
      if (score > bestScore) {
        bestScore = score;
        bestPhrase = phrase;
        bestCount = count;
      }
    }
    if (bestScore > 0) {
      lexical.set(n.id, {
        score: bestScore,
        phrase: bestPhrase,
        rationale: `Phrase "${bestPhrase}"${bestCount > 1 ? ` ×${bestCount}` : ""}`,
      });
    }
  }

  // ---- Semantic: embed phrases (+ short doc windows) vs field/subfield titles
  // Named theorems stay lexical-only — MiniLM overfits short contest phrases
  // onto famous theorem titles ("new string" → string theory).
  const embedRows = rows.filter((r) => r.type === "field" || r.type === "subfield");
  const index = await ensureNodeIndex(
    embedRows.map((r) => ({ id: r.id, title: r.title })),
  );
  // Prefer multiword content phrases; skip scaffolding that confuses MiniLM.
  const queryTexts = [
    ...phraseList
      .filter((p) => {
        const words = p.split(/\s+/);
        if (words.length < 2 || words.length > 10) return false;
        if (/^(number of|value of|all |the following)/i.test(p)) return false;
        return true;
      })
      .slice(0, 35),
    // One document window: denser signal than isolated scraps.
    clipped.slice(0, 900),
  ].filter((t) => t.trim().length >= 12);

  const queryVecs = await embedTexts(queryTexts);
  const semantic = new Map<string, { score: number; rationale: string }>();
  const typeById = new Map(rows.map((r) => [r.id, r]));

  for (const [nodeId, entry] of Object.entries(index.nodes)) {
    const row = typeById.get(nodeId);
    if (!row) continue;
    let best = 0;
    let bestQuery = "";
    for (let i = 0; i < queryVecs.length; i++) {
      const sim = cosine(queryVecs[i]!, entry.vector);
      if (sim > best) {
        best = sim;
        bestQuery = queryTexts[i]!.slice(0, 60);
      }
    }
    if (best < SEM_FLOOR) continue;
    const boosted =
      ((best - SEM_FLOOR) / (1 - SEM_FLOOR)) *
      (LEVEL_BOOST[row.type] ?? 1) *
      educationPenalty(nodeId, row.title);
    semantic.set(nodeId, {
      score: boosted,
      rationale: `Similar to "${bestQuery}${bestQuery.length >= 60 ? "…" : ""}" (${best.toFixed(2)})`,
    });
  }

  // Keep only the strongest semantic neighbors to limit noise.
  const semRanked = [...semantic.entries()]
    .sort((a, b) => b[1].score - a[1].score)
    .slice(0, SEM_TOP_K);
  semantic.clear();
  for (const [id, v] of semRanked) semantic.set(id, v);

  // ---- Fuse ----
  const ids = new Set([...lexical.keys(), ...semantic.keys()]);
  const fused: { nodeId: string; score: number; rationale: string; phrase?: string }[] = [];
  for (const id of ids) {
    const lex = lexical.get(id);
    const sem = semantic.get(id);
    const lexScore = lex?.score ?? 0;
    const semScore = sem?.score ?? 0;
    // Normalize loosely: lexical scores are typically 1–8; semantic 0–1.5.
    const score = 0.4 * Math.min(lexScore / 4, 1.5) + 0.6 * semScore;
    if (score <= 0) continue;
    const parts = [lex?.rationale, sem?.rationale].filter(Boolean);
    fused.push({
      nodeId: id,
      score,
      phrase: lex?.phrase,
      rationale: parts.join("; "),
    });
  }

  fused.sort((a, b) => b.score - a.score);
  const perPhrase = new Map<string, number>();
  const deduped = fused.filter((h) => {
    if (!h.phrase) return true;
    const seen = perPhrase.get(h.phrase) ?? 0;
    if (seen >= 2) return false;
    perPhrase.set(h.phrase, seen + 1);
    return true;
  });
  const top = deduped.slice(0, 30);
  if (top.length === 0) return [];
  const max = top[0]!.score;
  return top.map((h) => ({
    nodeId: h.nodeId,
    weight: Math.max(0.15, Math.min(1, h.score / max)),
    rationale: h.rationale,
  }));
}

// ---------------------------------------------------------------------------
// LLM classification (optional — needs an Anthropic API key)
// ---------------------------------------------------------------------------

/** Taxonomy prompt: all MSC fields + subfields (~600 lines). */
async function buildTaxonomy(db: Db): Promise<string> {
  const rows = await db
    .select({
      mscCode: schema.nodes.mscCode,
      title: schema.nodes.title,
      type: schema.nodes.type,
    })
    .from(schema.nodes)
    .where(inArray(schema.nodes.type, ["field", "subfield"]));
  rows.sort((a, b) => (a.mscCode! < b.mscCode! ? -1 : 1));
  return rows
    .map((r) => `${r.mscCode} ${r.type === "field" ? "" : "  "}${r.title}`)
    .join("\n");
}

/**
 * Classify a document's text against the MSC taxonomy with the Anthropic API.
 * Returns MSC codes with 0–1 weights and one-line rationales.
 */
export async function classifyDocument(
  text: string,
  kind: string,
  title: string,
  userApiKey?: string,
): Promise<Classification[]> {
  const apiKey = userApiKey?.trim() || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "No Anthropic API key — paste one in the upload form or set ANTHROPIC_API_KEY on the server. (Or use the default keyword analysis, which needs no key.)",
    );
  }
  const client = new Anthropic({ apiKey });
  const db = await getDb();
  const taxonomy = await buildTaxonomy(db);
  const clipped =
    text.length > MAX_DOC_CHARS ? `${text.slice(0, MAX_DOC_CHARS)}\n[...truncated]` : text;

  const response = await client.messages.create({
    model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-5",
    max_tokens: 4000,
    system: `You classify mathematical documents against the Mathematics Subject Classification (MSC 2020). Given a document, identify which areas of mathematics it covers.

Here is the taxonomy (code, then title; two-space indented rows are subfields of the field above them):

${taxonomy}

Respond with ONLY a JSON array, no other text. Each element:
{"code": "<MSC code from the taxonomy>", "weight": <0-1, how central this area is to the document>, "rationale": "<one short sentence: why>"}

Rules:
- Prefer the most specific subfield codes (e.g. "11Axx") when clear; use field codes ("11-XX") when the document covers the field broadly.
- 5-25 entries. Weight 1.0 = the document is centrally about this area; 0.2 = touched briefly.
- Only use codes that appear in the taxonomy.`,
    messages: [
      {
        role: "user",
        content: `Document kind: ${kind}\nDocument title: ${title}\n\nDocument text:\n\n${clipped}`,
      },
    ],
  });

  const raw = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) throw new Error("LLM returned no JSON array");
  const parsed = JSON.parse(match[0]) as Classification[];
  return parsed
    .filter((c) => c && typeof c.code === "string" && typeof c.weight === "number")
    .map((c) => ({ ...c, weight: Math.max(0, Math.min(1, c.weight)) }));
}

// ---------------------------------------------------------------------------
// Storage + weight propagation (shared by both methods)
// ---------------------------------------------------------------------------

/**
 * Resolve classifications to node ids, propagate weights up the tree
 * (a hit on 11A41 lights up 11Axx, 11-XX and Number Theory), and store
 * everything in document_nodes.
 */
export async function storeClassifications(
  documentId: string,
  classifications: Classification[],
): Promise<number> {
  const db = await getDb();
  const allNodes = await db
    .select({
      id: schema.nodes.id,
      mscCode: schema.nodes.mscCode,
      parentId: schema.nodes.parentId,
    })
    .from(schema.nodes);
  const byId = new Map(allNodes.map((n) => [n.id, n]));
  const byCode = new Map(allNodes.filter((n) => n.mscCode).map((n) => [n.mscCode!, n]));
  const parentOf = new Map(allNodes.map((n) => [n.id, n.parentId]));

  const direct = new Map<string, { weight: number; rationale: string }>();
  for (const c of classifications) {
    const node = c.nodeId
      ? byId.get(c.nodeId)
      : c.code
        ? (byCode.get(c.code) ??
          byCode.get(c.code.toUpperCase()) ??
          byCode.get(`${c.code.slice(0, 2)}-XX`))
        : undefined;
    if (!node) continue;
    const prev = direct.get(node.id);
    if (!prev || c.weight > prev.weight) {
      direct.set(node.id, { weight: c.weight, rationale: c.rationale });
    }
  }

  // propagate up: ancestor weight = max(descendant weight) * 0.92 per level
  const all = new Map<string, { weight: number; rationale: string | null; direct: boolean }>();
  for (const [id, v] of direct) {
    all.set(id, { weight: v.weight, rationale: v.rationale, direct: true });
  }
  for (const [id, v] of direct) {
    let cur = parentOf.get(id) ?? null;
    let w = v.weight;
    while (cur) {
      w *= 0.92;
      const existing = all.get(cur);
      if (!existing || (!existing.direct && existing.weight < w)) {
        all.set(cur, { weight: w, rationale: null, direct: false });
      }
      cur = parentOf.get(cur) ?? null;
    }
  }

  await db
    .delete(schema.documentNodes)
    .where(eq(schema.documentNodes.documentId, documentId));
  if (all.size > 0) {
    await db.insert(schema.documentNodes).values(
      [...all.entries()].map(([nodeId, v]) => ({
        documentId,
        nodeId,
        weight: v.weight,
        rationale: v.rationale,
        direct: v.direct,
      })),
    );
  }
  return direct.size;
}
