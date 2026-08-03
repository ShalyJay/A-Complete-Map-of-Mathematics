import Graph from "graphology";
import type { GraphNodeLite, GraphPayload } from "@/lib/types";
import { GRAND_BRANCHES } from "@/lib/branches";

export interface NodeIndex {
  byId: Map<string, GraphNodeLite>;
  children: Map<string, string[]>;
  /** grand-branch node id for every node (itself for branches) */
  branchOf: Map<string, string>;
  ancestorsOf: (id: string) => string[];
}

export function buildIndex(payload: GraphPayload): NodeIndex {
  const byId = new Map<string, GraphNodeLite>();
  const children = new Map<string, string[]>();
  for (const n of payload.nodes) byId.set(n.id, n);
  for (const n of payload.nodes) {
    if (!n.parentId) continue;
    let arr = children.get(n.parentId);
    if (!arr) children.set(n.parentId, (arr = []));
    arr.push(n.id);
  }
  // Stable order: MSC codes sort naturally, entities alphabetically.
  for (const arr of children.values()) arr.sort();

  const branchOf = new Map<string, string>();
  const resolveBranch = (id: string): string => {
    const cached = branchOf.get(id);
    if (cached) return cached;
    const n = byId.get(id);
    const result = !n || !n.parentId ? id : resolveBranch(n.parentId);
    branchOf.set(id, result);
    return result;
  };
  for (const n of payload.nodes) resolveBranch(n.id);

  const ancestorsOf = (id: string): string[] => {
    const out: string[] = [];
    let cur = byId.get(id);
    while (cur?.parentId) {
      out.unshift(cur.parentId);
      cur = byId.get(cur.parentId);
    }
    return out;
  };

  return { byId, children, branchOf, ancestorsOf };
}

export const NODE_SIZES: Record<number, number> = {
  0: 22,
  1: 11,
  2: 6,
  3: 3.2,
  4: 2,
};

const DIM = "#334155";

export function baseColor(nodeId: string, index: NodeIndex): string {
  const branchId = index.branchOf.get(nodeId);
  const branch = GRAND_BRANCHES.find((b) => b.id === branchId);
  if (!branch) return DIM;
  const depth = index.byId.get(nodeId)?.depth ?? 0;
  return mixToward(branch.color, "#0f172a", Math.min(depth * 0.13, 0.5));
}

export function mixToward(hex: string, towardHex: string, t: number): string {
  const a = parseHex(hex);
  const b = parseHex(towardHex);
  const c = a.map((v, i) => Math.round(v + (b[i] - v) * t));
  return `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

function parseHex(hex: string): number[] {
  const h = hex.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

/** Build the full graphology graph with all nodes hidden except branches. */
export function buildGraph(payload: GraphPayload, index: NodeIndex): Graph {
  const graph = new Graph({ multi: true, type: "undirected" });
  for (const n of payload.nodes) {
    graph.addNode(n.id, {
      label: n.title,
      size: NODE_SIZES[n.depth] ?? 2,
      color: baseColor(n.id, index),
      x: 0,
      y: 0,
      hidden: n.depth !== 0,
      depth: n.depth,
      childCount: n.childCount,
      nodeType: n.type,
    });
  }
  // child-of edges derived from parentId
  for (const n of payload.nodes) {
    if (n.parentId && graph.hasNode(n.parentId)) {
      graph.addEdgeWithKey(`t:${n.id}`, n.id, n.parentId, {
        edgeKind: "child-of",
        size: 0.8,
        color: "rgba(100,116,139,0.35)",
        hidden: true,
      });
    }
  }
  // cross-reference edges
  let i = 0;
  for (const e of payload.edges) {
    if (!graph.hasNode(e.source) || !graph.hasNode(e.target)) continue;
    graph.addEdgeWithKey(`x:${i++}`, e.source, e.target, {
      edgeKind: e.type,
      size: 0.5,
      color:
        e.type === "see-also" ? "rgba(251,191,36,0.25)" : "rgba(148,163,184,0.18)",
      hidden: true,
    });
  }
  return graph;
}
