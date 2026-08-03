import Anthropic from "@anthropic-ai/sdk";
import { eq, like, inArray } from "drizzle-orm";
import { getDb, schema, type Db } from "@/db";

export interface Classification {
  code: string;
  weight: number;
  rationale: string;
}

const MAX_DOC_CHARS = 60_000;

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
): Promise<Classification[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set — add it to .env.local to enable document analysis.",
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
  const mscNodes = await db
    .select({
      id: schema.nodes.id,
      mscCode: schema.nodes.mscCode,
      parentId: schema.nodes.parentId,
    })
    .from(schema.nodes)
    .where(like(schema.nodes.id, "msc:%"));
  const byCode = new Map(mscNodes.map((n) => [n.mscCode!, n]));
  const parentOf = new Map(mscNodes.map((n) => [n.id, n.parentId]));

  // branches too (parents of fields)
  const branches = await db
    .select({ id: schema.nodes.id, parentId: schema.nodes.parentId })
    .from(schema.nodes)
    .where(like(schema.nodes.id, "branch:%"));
  for (const b of branches) parentOf.set(b.id, b.parentId);

  const direct = new Map<string, { weight: number; rationale: string }>();
  for (const c of classifications) {
    const node =
      byCode.get(c.code) ??
      byCode.get(c.code.toUpperCase()) ??
      byCode.get(`${c.code.slice(0, 2)}-XX`);
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
