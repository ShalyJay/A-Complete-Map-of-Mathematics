import Graph from "graphology";
import type { GraphNodeLite, GraphPayload } from "@/lib/types";
import { branchShade, domainColor } from "@/lib/branches";
import { isLeafType } from "@/lib/nodeKinds";

export interface NodeIndex {
  byId: Map<string, GraphNodeLite>;
  children: Map<string, string[]>;
  /** root (domain) node id for every node (itself for roots) */
  branchOf: Map<string, string>;
  /** top-level branch (depth-1 ancestor) for every node below a root: drives colour */
  shadeOf: Map<string, string>;
  /** depends-on DAG: node -> its prerequisites (what it builds on) */
  depsOf: Map<string, string[]>;
  /** depends-on DAG: node -> its dependents (what builds on it) */
  dependentsOf: Map<string, string[]>;
  ancestorsOf: (id: string) => string[];
}

/**
 * A map whose only child is another map (e.g. an MSC field with a single subfield, or a section with
 * one subsection) is a click with no choice in it. Merge that lone child into its parent: the
 * child's children move up and the parent carries the child's name/code as a sublabel. Roots are
 * never merged away.
 */
export function collapseSingleFieldBranches(payload: GraphPayload): GraphPayload {
  const childrenOf = new Map<string, GraphNodeLite[]>();
  for (const n of payload.nodes) {
    if (!n.parentId) continue;
    let arr = childrenOf.get(n.parentId);
    if (!arr) childrenOf.set(n.parentId, (arr = []));
    arr.push(n);
  }
  const byId = new Map(payload.nodes.map((n) => [n.id, n]));
  const removed = new Map<string, string>(); // lone child id -> the node that absorbs it
  const absorbed = new Map<string, GraphNodeLite>(); // absorber id -> its (last) absorbed child
  for (const parent of payload.nodes) {
    if (isLeafType(parent.type) || parent.depth === 0) continue;
    const kids = childrenOf.get(parent.id) ?? [];
    if (kids.length !== 1 || isLeafType(kids[0].type)) continue;
    removed.set(kids[0].id, parent.id);
  }
  if (removed.size === 0) return payload;
  // chains (A -> B -> C each single): everything folds into the top survivor
  const survivor = (id: string): string => (removed.has(id) ? survivor(removed.get(id)!) : id);
  for (const [child] of removed) absorbed.set(survivor(child), byId.get(child)!);

  const nodes: GraphNodeLite[] = [];
  for (const n of payload.nodes) {
    if (removed.has(n.id)) continue;
    let node = n;
    if (n.parentId && removed.has(n.parentId)) node = { ...n, parentId: survivor(n.parentId) };
    const lone = absorbed.get(n.id);
    if (lone) {
      const sameName = lone.title.trim().toLowerCase() === n.title.trim().toLowerCase();
      const parts = [...(sameName ? [] : [lone.title]), ...(lone.sublabel ? [lone.sublabel] : [])];
      node = { ...node, childCount: lone.childCount, sublabel: parts.join(" · ") || n.sublabel };
    }
    nodes.push(node);
  }
  const keep = (id: string) => !removed.has(id);
  const edges = payload.edges.filter((e) => keep(e.source) && keep(e.target));
  return { nodes, edges };
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
  const shadeOf = new Map<string, string>();
  const resolveShade = (id: string): string => {
    const cached = shadeOf.get(id);
    if (cached) return cached;
    const n = byId.get(id);
    const result = !n || !n.parentId ? id : byId.get(n.parentId)?.parentId ? resolveShade(n.parentId) : id;
    shadeOf.set(id, result);
    return result;
  };
  for (const n of payload.nodes) resolveShade(n.id);

  const depsOf = new Map<string, string[]>();
  const dependentsOf = new Map<string, string[]>();
  for (const e of payload.edges) {
    if (e.type !== "depends-on") continue;
    if (!byId.has(e.source) || !byId.has(e.target)) continue;
    let d = depsOf.get(e.source);
    if (!d) depsOf.set(e.source, (d = []));
    d.push(e.target);
    let u = dependentsOf.get(e.target);
    if (!u) dependentsOf.set(e.target, (u = []));
    u.push(e.source);
  }

  const ancestorsOf = (id: string): string[] => {
    const out: string[] = [];
    let cur = byId.get(id);
    while (cur?.parentId) {
      out.unshift(cur.parentId);
      cur = byId.get(cur.parentId);
    }
    return out;
  };

  return { byId, children, branchOf, shadeOf, depsOf, dependentsOf, ancestorsOf };
}

/** Big labeled bubbles for taxonomy levels; small dots for leaf entities. */
const SIZE_BY_TYPE: Record<string, number> = {
  domain: 52,
  branch: 34,
  field: 25,
  subfield: 18,
  topic: 10,
  concept: 4.5,
  axiom: 7.5,
  conjecture: 4.2,
  theorem: 4,
  definition: 4,
};

const LABELED_TYPES = ["domain", "branch", "field", "subfield"];

const DIM = "#334155";

export function baseColor(nodeId: string, index: NodeIndex): string {
  const rootId = index.branchOf.get(nodeId);
  if (!rootId) return DIM;
  const shadeId = index.shadeOf.get(nodeId) ?? rootId;
  const branch = {
    color:
      shadeId === rootId
        ? domainColor(rootId)
        : branchShade(rootId, shadeId, index.children.get(rootId) ?? []),
  };
  const node = index.byId.get(nodeId);
  // Axioms glow: they are the bright core everything grows from.
  if (node?.type === "axiom") return mixToward(branch.color, "#fef3c7", 0.55);
  if (node?.type === "conjecture") return mixToward(branch.color, "#94a3b8", 0.35);
  const depth = node?.depth ?? 0;
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

/**
 * Build the full graphology graph. Positions are assigned dynamically by the
 * expansion-driven layout in MathMap; only branches start visible.
 */
export function buildGraph(payload: GraphPayload, index: NodeIndex): Graph {
  const graph = new Graph({ multi: true, type: "directed" });

  for (const n of payload.nodes) {
    // Results anchored in the derivation DAG are slightly larger — they're
    // the load-bearing theorems of the map.
    let size = SIZE_BY_TYPE[n.type] ?? 4;
    if (n.type === "theorem" && index.depsOf.has(n.id)) size = 5;
    // labeled bubbles grow a little with longer titles so the text fits
    if (LABELED_TYPES.includes(n.type)) {
      size *= Math.min(1.3, Math.max(0.95, 0.85 + n.title.length / 80));
    }
    graph.addNode(n.id, {
      label: n.title,
      sublabel: n.sublabel,
      size,
      color: baseColor(n.id, index),
      x: 0,
      y: 0,
      hidden: n.depth !== 0,
      depth: n.depth,
      childCount: n.childCount,
      nodeType: n.type,
      // taxonomy bubbles carry their label inside the circle — never drop it
      forceLabel: LABELED_TYPES.includes(n.type),
    });
  }

  // child-of edges derived from parentId (structural scaffolding, kept faint;
  // barely visible for the thousands of leaf entities to avoid hairball noise)
  for (const n of payload.nodes) {
    if (n.parentId && graph.hasNode(n.parentId)) {
      const isLeafEntity = isLeafType(n.type);
      graph.addEdgeWithKey(`t:${n.id}`, n.id, n.parentId, {
        edgeKind: "child-of",
        size: isLeafEntity ? 0.3 : 0.5,
        color: isLeafEntity ? "rgba(100,116,139,0.05)" : "rgba(100,116,139,0.13)",
        hidden: true,
      });
    }
  }

  // cross-reference + dependency edges
  let i = 0;
  for (const e of payload.edges) {
    if (!graph.hasNode(e.source) || !graph.hasNode(e.target)) continue;
    if (e.type === "depends-on") {
      // stored as dependent -> prerequisite; draw the arrow in derivation
      // direction (prerequisite -> dependent) so chains read axiom -> theorem.
      graph.addEdgeWithKey(`d:${i++}`, e.target, e.source, {
        edgeKind: "depends-on",
        type: "curvedArrow",
        curvature: 0.15,
        size: 1.1,
        color: "rgba(251,146,60,0.65)",
        hidden: true,
      });
    } else {
      graph.addEdgeWithKey(`x:${i++}`, e.source, e.target, {
        edgeKind: e.type,
        type: "curved",
        curvature: 0.25,
        size: e.type === "bridge" ? 0.9 : 0.5,
        color:
          e.type === "bridge"
            ? "rgba(52,211,153,0.35)"
            : e.type === "see-also"
              ? "rgba(251,191,36,0.18)"
              : "rgba(148,163,184,0.12)",
        hidden: true,
      });
    }
  }
  return graph;
}
