/**
 * Read-only graph loaded from data/static-graph.json.
 * Used on Vercel (and anywhere without a live PGlite/Postgres).
 */
import fs from "node:fs";
import path from "node:path";
import type { GraphPayload, NodeDetail } from "@/lib/types";

export interface StaticNode {
  id: string;
  title: string;
  type: string;
  depth: number;
  parentId: string | null;
  childCount: number;
  mscCode: string | null;
  wikidataQid: string | null;
  summary: string | null;
  wikipediaUrl: string | null;
  thumbnailUrl: string | null;
}

export interface StaticEdge {
  source: string;
  target: string;
  type: string;
  note: string | null;
}

export interface StaticGraph {
  version: number;
  exportedAt: string;
  nodes: StaticNode[];
  edges: StaticEdge[];
}

const STATIC_PATH = path.join(process.cwd(), "data", "static-graph.json");

let cached: StaticGraph | null = null;
let byId: Map<string, StaticNode> | null = null;

export function staticGraphPath(): string {
  return STATIC_PATH;
}

export function hasStaticGraph(): boolean {
  return fs.existsSync(STATIC_PATH);
}

export function loadStaticGraph(): StaticGraph {
  if (cached) return cached;
  if (!fs.existsSync(STATIC_PATH)) {
    throw new Error(
      `Missing ${STATIC_PATH}. Run \`npm run export:graph\` locally after ingest, commit data/static-graph.json, and redeploy.`,
    );
  }
  cached = JSON.parse(fs.readFileSync(STATIC_PATH, "utf8")) as StaticGraph;
  byId = new Map(cached.nodes.map((n) => [n.id, n]));
  return cached;
}

function nodeMap(): Map<string, StaticNode> {
  loadStaticGraph();
  return byId!;
}

export function staticGraphPayload(): GraphPayload {
  const g = loadStaticGraph();
  return {
    nodes: g.nodes.map((n) => ({
      id: n.id,
      title: n.title,
      type: n.type,
      depth: n.depth,
      parentId: n.parentId,
      childCount: n.childCount,
    })),
    edges: g.edges
      .filter((e) => e.type === "see-also" || e.type === "related" || e.type === "depends-on")
      .map((e) => ({ source: e.source, target: e.target, type: e.type })),
  };
}

export function staticAllNodes(): StaticNode[] {
  return loadStaticGraph().nodes;
}

export function staticNodeDetail(id: string): NodeDetail | null {
  const g = loadStaticGraph();
  const map = nodeMap();
  const node = map.get(id);
  if (!node) return null;

  const relEdges = g.edges.filter((e) => e.source === id || e.target === id);
  const connections: NodeDetail["connections"] = [];
  const seen = new Set<string>();

  for (const e of relEdges) {
    const otherId = e.source === id ? e.target : e.source;
    const other = map.get(otherId);
    if (!other || seen.has(otherId)) continue;
    seen.add(otherId);
    let relation: string;
    if (e.type === "child-of") {
      relation = e.source === id ? "parent" : "child";
    } else if (e.type === "depends-on") {
      relation = e.source === id ? "builds-on" : "leads-to";
    } else {
      relation = e.type;
    }
    let note = e.note ?? null;
    if (!note) {
      if (relation === "builds-on") {
        note = `The standard proof of ${node.title} makes essential use of ${other.title}.`;
      } else if (relation === "leads-to") {
        note = `${other.title} is proved using ${node.title}.`;
      } else if (relation === "see-also") {
        note = `MSC 2020 cross-references these two classifications: work in one routinely cites the other.`;
      } else if (relation === "related") {
        note = `Listed as related areas in the MSC 2020 classification.`;
      }
    }
    connections.push({
      id: other.id,
      title: other.title,
      type: other.type,
      relation,
      note,
    });
  }

  const order: Record<string, number> = {
    "builds-on": 0,
    "leads-to": 1,
    parent: 2,
    child: 3,
    "see-also": 4,
    related: 5,
  };
  connections.sort((a, b) => (order[a.relation] ?? 9) - (order[b.relation] ?? 9));

  let summary = node.summary;
  if (!summary || summary.trim().length < 10) {
    const parent = node.parentId ? map.get(node.parentId) : undefined;
    const kids = g.nodes.filter((n) => n.parentId === id);
    const TAXONOMY = ["branch", "field", "subfield", "topic"];
    const kidTax = kids.filter((k) => TAXONOMY.includes(k.type));
    const kidEnt = kids.filter((k) => !TAXONOMY.includes(k.type));
    const LEVEL_WORD: Record<string, string> = {
      branch: "branch of mathematics",
      field: "field",
      subfield: "subfield",
      topic: "topic",
    };
    const parts: string[] = [];
    if (TAXONOMY.includes(node.type)) {
      const where = parent ? ` within ${parent.title}` : "";
      const msc = node.mscCode
        ? ` It is classified as MSC ${node.mscCode} in the Mathematics Subject Classification.`
        : "";
      parts.push(
        `${node.title} is a ${LEVEL_WORD[node.type] ?? "area"}${where}.${msc}`,
      );
      if (kidTax.length > 0) {
        const sample = kidTax
          .slice(0, 4)
          .map((k) => k.title.toLowerCase())
          .join(", ");
        parts.push(
          `It spans ${kidTax.length} subtopic${kidTax.length === 1 ? "" : "s"}, including ${sample}.`,
        );
      }
      if (kidEnt.length > 0) {
        const sample = kidEnt.slice(0, 3).map((k) => k.title).join("; ");
        parts.push(
          `The map places ${kidEnt.length} named results under it — for example: ${sample}.`,
        );
      }
      if (kidTax.length === 0 && kidEnt.length === 0) {
        parts.push(
          "A specialist classification with no named results attached yet — see its cross-references and parent area for context.",
        );
      }
    } else {
      parts.push(
        `${node.title} is a ${node.type}${parent ? ` in ${parent.title}` : ""}. No detailed summary is available yet — see the linked references and its connections below.`,
      );
    }
    summary = parts.join(" ");
  }

  return {
    id: node.id,
    mscCode: node.mscCode,
    wikidataQid: node.wikidataQid,
    type: node.type,
    title: node.title,
    summary,
    wikipediaUrl: node.wikipediaUrl,
    thumbnailUrl: node.thumbnailUrl,
    depth: node.depth,
    parentId: node.parentId,
    connections: connections.slice(0, 60),
  };
}
