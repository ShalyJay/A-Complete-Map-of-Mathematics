/**
 * Read-only graph built from the Personal Wiki vault's export in data/vault/ (graph.json and
 * references.json, written by the vault's `_tools/export_site.py` and synced by its git hook).
 * The files are re-read when their modification time changes, so `next dev` picks up a sync
 * without a restart.
 */
import fs from "node:fs";
import path from "node:path";
import type { GraphPayload, NodeDetail } from "@/lib/types";
import {
  buildSiteGraph,
  relinkReference,
  type SiteGraph,
  type SiteNode,
  type VaultExport,
} from "@/lib/vaultGraph";

export type { SiteNode as StaticNode } from "@/lib/vaultGraph";

const DIR = path.join(process.cwd(), "data", "vault");
const GRAPH_PATH = path.join(DIR, "graph.json");
const REFS_PATH = path.join(DIR, "references.json");

let cached: { mtime: number; graph: SiteGraph; payload: GraphPayload } | null = null;
let refs: { mtime: number; byId: Map<string, string> } | null = null;

export function staticGraphPath(): string {
  return GRAPH_PATH;
}

export function hasStaticGraph(): boolean {
  return fs.existsSync(GRAPH_PATH);
}

export function missingGraphMessage(): string {
  return `Missing ${GRAPH_PATH}. Run \`npm run sync:vault\` (needs the Personal Wiki vault) or restore data/vault/ from git.`;
}

export function loadStaticGraph(): SiteGraph {
  if (!fs.existsSync(GRAPH_PATH)) throw new Error(missingGraphMessage());
  const mtime = fs.statSync(GRAPH_PATH).mtimeMs;
  if (!cached || cached.mtime !== mtime) {
    const graph = buildSiteGraph(JSON.parse(fs.readFileSync(GRAPH_PATH, "utf8")) as VaultExport);
    cached = { mtime, graph, payload: toPayload(graph) };
    refs = null;
  }
  return cached.graph;
}

const PAYLOAD_EDGES = new Set(["depends-on", "related", "see-also", "bridge"]);

export function toPayload(g: SiteGraph): GraphPayload {
  return {
    nodes: g.nodes.map((n) => ({
      id: n.id,
      title: n.title,
      type: n.type,
      depth: n.depth,
      parentId: n.parentId,
      childCount: n.childCount,
      ...(n.sublabel ? { sublabel: n.sublabel } : {}),
    })),
    edges: g.edges
      .filter((e) => PAYLOAD_EDGES.has(e.type) && e.relation !== "also filed under")
      .map((e) => ({ source: e.source, target: e.target, type: e.type })),
  };
}

export function staticGraphPayload(): GraphPayload {
  loadStaticGraph();
  return cached!.payload;
}

export function staticAllNodes(): SiteNode[] {
  return loadStaticGraph().nodes;
}

function reference(id: string): string | null {
  const g = loadStaticGraph();
  if (!fs.existsSync(REFS_PATH)) return null;
  const mtime = fs.statSync(REFS_PATH).mtimeMs;
  if (!refs || refs.mtime !== mtime) {
    const raw = JSON.parse(fs.readFileSync(REFS_PATH, "utf8")) as { references: Record<string, string> };
    const byId = new Map<string, string>();
    for (const [key, md] of Object.entries(raw.references)) {
      const n = g.byKey.get(key);
      if (n) byId.set(n.id, relinkReference(md, (k) => g.byKey.get(k)?.id ?? null));
    }
    refs = { mtime, byId };
  }
  return refs.byId.get(id) ?? null;
}

/** How a related-edge relation reads from the other end ("A generalizes B" seen from B). */
const REVERSE: Record<string, string> = {
  "builds on": "built on by",
  generalizes: "generalized by",
  "special case of": "has special case",
  "used in": "uses",
  "application of": "has application",
  prerequisite: "prerequisite for",
  "also filed under": "also contains",
};

const ORDER: Record<string, number> = {
  bridge: 0,
  "builds-on": 1,
  "leads-to": 2,
  parent: 3,
  child: 4,
};

export function staticNodeDetail(id: string): NodeDetail | null {
  const g = loadStaticGraph();
  const node = g.byId.get(id);
  if (!node) return null;

  const connections: NodeDetail["connections"] = [];
  const seen = new Set<string>();
  for (const e of g.edges) {
    if (e.source !== id && e.target !== id) continue;
    const out = e.source === id;
    const other = g.byId.get(out ? e.target : e.source);
    if (!other) continue;
    let relation: string;
    if (e.type === "child-of") relation = out ? "parent" : "child";
    else if (e.type === "depends-on") relation = out ? "builds-on" : "leads-to";
    else if (e.type === "bridge") relation = "bridge";
    else relation = out ? e.relation ?? e.type : REVERSE[e.relation ?? ""] ?? e.relation ?? e.type;
    const dedupe = `${other.id}|${relation}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    connections.push({
      id: other.id,
      title: other.title,
      type: other.type,
      relation,
      note: e.note,
      principle: e.principle,
      principleStatement: e.principle ? g.principles.get(e.principle) ?? null : null,
      sourceUrl: e.sourceUrl,
      flag: e.flag,
    });
  }
  connections.sort((a, b) => (ORDER[a.relation] ?? 9) - (ORDER[b.relation] ?? 9));

  let summary = node.summary;
  if ((!summary || summary.trim().length < 10) && !node.wikipediaExtract) {
    const parent = node.parentId ? g.byId.get(node.parentId) : undefined;
    const kids = g.nodes.filter((n) => n.parentId === id);
    const maps = kids.filter((k) => ["branch", "field", "subfield", "topic"].includes(k.type));
    const leaves = kids.filter((k) => !maps.includes(k));
    const parts: string[] = [];
    const where = parent ? ` within ${parent.title}` : "";
    const msc = node.mscCode ? ` Its Mathematics Subject Classification code is ${node.mscCode}.` : "";
    parts.push(`${node.title} is ${/^[aeiou]/i.test(node.type) ? "an" : "a"} ${node.type}${where}.${msc}`);
    if (maps.length) {
      parts.push(`It has ${maps.length} sub-area${maps.length === 1 ? "" : "s"}, including ${maps.slice(0, 4).map((k) => k.title).join(", ")}.`);
    }
    if (leaves.length) {
      parts.push(`${leaves.length} concept${leaves.length === 1 ? " is" : "s are"} filed here, for example: ${leaves.slice(0, 3).map((k) => k.title).join("; ")}.`);
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
    wikipediaExtract: node.wikipediaExtract,
    depth: node.depth,
    parentId: node.parentId,
    domain: node.domain,
    codes: node.codes,
    aliases: node.aliases,
    reference: reference(id),
    verified: node.verified,
    researchScore: node.researchScore,
    connections: connections.slice(0, 60),
  };
}
