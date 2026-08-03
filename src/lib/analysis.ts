import Anthropic from "@anthropic-ai/sdk";
import { eq, inArray } from "drizzle-orm";
import { getDb, schema, type Db } from "@/db";

export interface Classification {
  /** MSC code (LLM path) — resolved to a node id when storing */
  code?: string;
  /** Direct node id (keyword path) */
  nodeId?: string;
  weight: number;
  rationale: string;
}

export type AnalysisMethod = "keyword" | "llm";

const MAX_DOC_CHARS = 60_000;

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

/**
 * Lightweight offline classification: scan the document for occurrences of
 * node titles (MSC topics/subfields/fields + named theorems). Specific,
 * deeper matches score higher; the top matches become coverage weights.
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

  const doc = ` ${text.slice(0, MAX_DOC_CHARS).toLowerCase().replace(/\s+/g, " ")} `;

  const LEVEL_BOOST: Record<string, number> = {
    field: 0.7,
    subfield: 1.0,
    topic: 1.25,
    theorem: 1.6,
    axiom: 1.6,
    conjecture: 1.6,
    definition: 1.4,
  };

  const hits: { nodeId: string; phrase: string; score: number; rationale: string }[] = [];
  for (const n of rows) {
    let bestScore = 0;
    let bestPhrase = "";
    let bestCount = 0;
    for (const phrase of phrasesFor(n.title, n.type)) {
      const count = (doc.match(phraseRegex(phrase)) ?? []).length;
      if (count === 0) continue;
      // longer phrases are more specific, diminishing returns on repeats
      const specificity = 0.6 + Math.min(phrase.length / 14, 1.4);
      // favor nodes whose title mostly IS the phrase (canonical matches)
      const titleFit = 0.7 + 0.3 * Math.min(1, phrase.length / n.title.length);
      let score =
        (1 + Math.log2(count)) * specificity * titleFit * (LEVEL_BOOST[n.type] ?? 1);
      // MSC 97 (mathematics education) mirrors every field's name — down-rank it
      if (/educational aspects|education of|^msc:97/i.test(`${n.title} ${n.id}`)) {
        score *= 0.25;
      }
      if (score > bestScore) {
        bestScore = score;
        bestPhrase = phrase;
        bestCount = count;
      }
    }
    if (bestScore > 0) {
      hits.push({
        nodeId: n.id,
        phrase: bestPhrase,
        score: bestScore,
        rationale: `Matched "${bestPhrase}"${bestCount > 1 ? ` ×${bestCount}` : ""}`,
      });
    }
  }

  hits.sort((a, b) => b.score - a.score);
  // One phrase shouldn't scatter weight across many obscure topics: keep the
  // 2 best nodes per matched phrase.
  const perPhrase = new Map<string, number>();
  const deduped = hits.filter((h) => {
    const seen = perPhrase.get(h.phrase) ?? 0;
    if (seen >= 2) return false;
    perPhrase.set(h.phrase, seen + 1);
    return true;
  });
  const top = deduped.slice(0, 30);
  if (top.length === 0) return [];
  const max = top[0].score;
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
