/**
 * Parse the MSC 2020 SKOS Turtle file into nodes + edges.
 *
 * Node levels produced:
 *   branch   (depth 0)  curated grand branches from src/lib/branches.ts
 *   field    (depth 1)  MSC top level, notation "11-XX"
 *   subfield (depth 2)  MSC middle level, notation "11Axx"
 *   topic    (depth 3)  MSC leaf, notation "11A41" (incl. "11-01" style codes)
 *
 * Edges produced:
 *   child-of   child -> parent (from skos:broader / branch grouping)
 *   see-also   from mscvocab:seeAlso
 *   related    from mscvocab:seeConditionally
 *
 * Usage: npm run ingest:msc
 * Expects the Turtle file at data/cache/msc2020.ttl (downloaded from
 * https://github.com/TIBHannover/MSC2020_SKOS, msc-2020-suggestion4.ttl).
 */
import fs from "node:fs";
import path from "node:path";
import { Parser, type Quad } from "n3";
import { inArray, like, or, sql } from "drizzle-orm";
import { getDb, schema } from "../src/db/index";
import { GRAND_BRANCHES, branchForMscPrefix } from "../src/lib/branches";
import { chunk } from "./lib";

const TTL_PATH = path.join(process.cwd(), "data", "cache", "msc2020.ttl");
const TTL_URL =
  "https://raw.githubusercontent.com/TIBHannover/MSC2020_SKOS/master/msc-2020-suggestion4.ttl";

const SKOS = "http://www.w3.org/2004/02/skos/core#";
const MSCVOCAB = "http://msc2020.org/resources/MSC/msc2020/mscvocab#";
const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";

interface RawConcept {
  uri: string;
  notation?: string;
  label?: string;
  labelLang?: string;
  scopeNote?: string;
  scopeNoteLang?: string;
  broader?: string;
  seeAlso: string[];
  seeConditionally: string[];
  isConcept: boolean;
}

async function ensureTtl(): Promise<void> {
  if (fs.existsSync(TTL_PATH)) return;
  console.log(`Downloading MSC 2020 SKOS from ${TTL_URL} ...`);
  fs.mkdirSync(path.dirname(TTL_PATH), { recursive: true });
  const res = await fetch(TTL_URL);
  if (!res.ok) throw new Error(`Failed to download MSC ttl: ${res.status}`);
  fs.writeFileSync(TTL_PATH, await res.text());
}

function parseConcepts(ttl: string): Map<string, RawConcept> {
  const parser = new Parser();
  const quads: Quad[] = parser.parse(ttl);
  const concepts = new Map<string, RawConcept>();

  const get = (uri: string): RawConcept => {
    let c = concepts.get(uri);
    if (!c) {
      c = { uri, seeAlso: [], seeConditionally: [], isConcept: false };
      concepts.set(uri, c);
    }
    return c;
  };

  for (const q of quads) {
    if (q.subject.termType !== "NamedNode") continue;
    const s = q.subject.value;
    const p = q.predicate.value;
    const o = q.object.value;
    // Labels/notes are multilingual (@en/@de …) — always prefer English.
    const lang = q.object.termType === "Literal" ? q.object.language : "";
    switch (p) {
      case RDF_TYPE:
        if (o === `${SKOS}Concept`) get(s).isConcept = true;
        break;
      case `${SKOS}notation`:
        get(s).notation = o;
        break;
      case `${SKOS}prefLabel`: {
        const c = get(s);
        if (c.labelLang !== "en" && (lang === "en" || !c.label)) {
          c.label = o;
          c.labelLang = lang;
        }
        break;
      }
      case `${SKOS}scopeNote`: {
        const c = get(s);
        if (c.scopeNoteLang !== "en" && (lang === "en" || !c.scopeNote)) {
          c.scopeNote = o;
          c.scopeNoteLang = lang;
        }
        break;
      }
      case `${SKOS}broader`:
        get(s).broader = o;
        break;
      case `${MSCVOCAB}seeAlso`:
        get(s).seeAlso.push(o);
        break;
      case `${MSCVOCAB}seeConditionally`:
        get(s).seeConditionally.push(o);
        break;
    }
  }
  return concepts;
}

function levelOf(code: string): { type: string; depth: number } {
  if (/^\d\d-XX$/.test(code)) return { type: "field", depth: 1 };
  if (/^\d\d[A-Z]xx$/.test(code)) return { type: "subfield", depth: 2 };
  return { type: "topic", depth: 3 };
}

/** MSC scope notes embed cross-reference syntax like {For ..., see 11J70} [See also ...]. Strip it for display. */
function cleanScopeNote(note: string | undefined): string | undefined {
  if (!note) return undefined;
  const cleaned = note
    .replace(/\\\{[^}]*\\\}/g, "")
    .replace(/\{[^}]*\}/g, "")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length > 0 ? cleaned : undefined;
}

async function main() {
  await ensureTtl();
  console.log("Parsing Turtle file...");
  const ttl = fs.readFileSync(TTL_PATH, "utf8");
  const concepts = parseConcepts(ttl);

  const uriToCode = new Map<string, string>();
  const valid: RawConcept[] = [];
  for (const c of concepts.values()) {
    if (!c.isConcept || !c.notation || !c.label) continue;
    uriToCode.set(c.uri, c.notation);
    valid.push(c);
  }
  console.log(`Found ${valid.length} MSC concepts`);

  type NodeRow = typeof schema.nodes.$inferInsert;
  type EdgeRow = typeof schema.edges.$inferInsert;
  const nodeRows: NodeRow[] = [];
  const edgeRows: EdgeRow[] = [];

  // Grand branches (depth 0)
  for (const b of GRAND_BRANCHES) {
    nodeRows.push({
      id: b.id,
      type: "branch",
      title: b.title,
      summary: b.summary,
      depth: 0,
      parentId: null,
    });
  }

  // Prune entire MSC sections (fields + all their descendants) that have no
  // grand-branch mapping — e.g. physics (70-86) and computer science (68, 94),
  // which are excluded from the mathematics map.
  const keptCodes = new Set<string>();
  for (const c of valid) {
    if (branchForMscPrefix(c.notation!.slice(0, 2))) keptCodes.add(c.notation!);
  }

  let skippedNoBranch = 0;
  for (const c of valid) {
    const code = c.notation!;
    if (!keptCodes.has(code)) {
      skippedNoBranch++;
      continue;
    }
    const { type, depth } = levelOf(code);

    let parentId: string | null = null;
    if (type === "field") {
      parentId = branchForMscPrefix(code.slice(0, 2))!.id;
    } else if (c.broader) {
      const parentCode = uriToCode.get(c.broader);
      if (parentCode) parentId = `msc:${parentCode}`;
    }
    // Some leaves (e.g. "11-01" course texts) sit directly under the top level.
    if (!parentId && type !== "field") {
      const topCode = `${code.slice(0, 2)}-XX`;
      if (uriToCode.has(`http://msc2020.org/resources/MSC/msc2020/${topCode}`)) {
        parentId = `msc:${topCode}`;
      }
    }

    const id = `msc:${code}`;
    nodeRows.push({
      id,
      mscCode: code,
      type,
      title: c.label!,
      summary: cleanScopeNote(c.scopeNote) ?? null,
      depth,
      parentId,
    });
    if (parentId) {
      edgeRows.push({ source: id, target: parentId, type: "child-of" });
    }
    for (const target of c.seeAlso) {
      const tCode = uriToCode.get(target);
      if (tCode && keptCodes.has(tCode)) {
        edgeRows.push({ source: id, target: `msc:${tCode}`, type: "see-also" });
      }
    }
    for (const target of c.seeConditionally) {
      const tCode = uriToCode.get(target);
      if (tCode && keptCodes.has(tCode)) {
        edgeRows.push({ source: id, target: `msc:${tCode}`, type: "related" });
      }
    }
  }

  if (skippedNoBranch > 0) {
    console.warn(`Skipped ${skippedNoBranch} concepts in unmapped sections (physics/CS)`);
  }
  console.log(`Prepared ${nodeRows.length} nodes, ${edgeRows.length} edges. Writing...`);

  const db = await getDb();

  // Idempotent re-run: wipe previously ingested MSC/branch data.
  const nodeIds = nodeRows.map((n) => n.id);
  await db.delete(schema.edges).where(
    or(
      inArray(schema.edges.source, nodeIds),
      inArray(schema.edges.target, nodeIds),
    ),
  );
  await db.delete(schema.nodes).where(
    or(like(schema.nodes.id, "msc:%"), like(schema.nodes.id, "branch:%")),
  );

  for (const batch of chunk(nodeRows, 500)) {
    await db.insert(schema.nodes).values(batch);
  }
  for (const batch of chunk(edgeRows, 500)) {
    await db.insert(schema.edges).values(batch);
  }

  const counts = await db.execute(
    sql`select type, count(*)::int as n from nodes group by type order by n desc`,
  );
  console.log("Node counts by type:", counts);
  console.log("MSC ingestion complete.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
