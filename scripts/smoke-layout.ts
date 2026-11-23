/**
 * Headless smoke test of the client's graph pipeline on the real data (no browser):
 * collapse -> index -> graphology graph -> 2D and 3D layout, with every map on a sampled path
 * expanded. Fails on an exception, a non-finite position, or a visible node without a position.
 *   npm run smoke:layout
 */
import { loadStaticGraph, toPayload } from "../src/lib/staticGraph";
import { buildGraph, buildIndex, collapseSingleFieldBranches } from "../src/components/map/graphStore";
import { computeLayout, computeLevels } from "../src/components/map/layout";
import { computeLayout3D } from "../src/components/map/layout3d";
import { isLeafType } from "../src/lib/nodeKinds";

const payload = collapseSingleFieldBranches(toPayload(loadStaticGraph()));
const index = buildIndex(payload);
const graph = buildGraph(payload, index);
const levels = computeLevels(index);
const problems: string[] = [];

const roots = payload.nodes.filter((n) => n.depth === 0).map((n) => n.id);
// expand: every root, then the largest child at each level down a few paths per root
const expanded = new Set<string>(roots);
for (const r of roots) {
  let frontier = [r];
  for (let d = 0; d < 5; d++) {
    const next: string[] = [];
    for (const id of frontier) {
      const kids = (index.children.get(id) ?? []).filter((k) => !isLeafType(index.byId.get(k)?.type));
      kids.sort((a, b) => (index.byId.get(b)?.childCount ?? 0) - (index.byId.get(a)?.childCount ?? 0));
      for (const k of kids.slice(0, 2)) {
        expanded.add(k);
        next.push(k);
      }
    }
    frontier = next;
  }
}
const chain = new Set<string>();
for (const [dep, pre] of index.depsOf) {
  chain.add(dep);
  for (const p of pre) chain.add(p);
  if (chain.size > 40) break;
}

const visibleUnder = (exp: Set<string>) => {
  const vis = new Set<string>(roots);
  const walk = (id: string) => {
    if (!exp.has(id)) return;
    for (const k of index.children.get(id) ?? []) {
      vis.add(k);
      walk(k);
    }
  };
  roots.forEach(walk);
  return vis;
};
const vis = visibleUnder(expanded);
const p2 = computeLayout(index, expanded, chain, levels);
const p3 = computeLayout3D(index, expanded, chain, levels);
for (const id of vis) {
  const a = p2.get(id);
  const b = p3.get(id);
  if (!a || !Number.isFinite(a.x) || !Number.isFinite(a.y)) problems.push(`2D position of ${id}`);
  if (!b || ![b.x, b.y, b.z].every(Number.isFinite)) problems.push(`3D position of ${id}`);
}
const colors = new Set(payload.nodes.map((n) => graph.getNodeAttribute(n.id, "color") as string));
if (colors.has("#334155")) problems.push("some node fell back to the grey 'no branch' colour");
console.log(
  `${payload.nodes.length} nodes after collapse (${toPayload(loadStaticGraph()).nodes.length - payload.nodes.length} merged), ` +
    `${roots.length} roots, ${expanded.size} expanded, ${vis.size} visible, ${chain.size} chain nodes, ${colors.size} colours`,
);
if (problems.length) {
  console.error(`FAIL: ${problems.length}`, problems.slice(0, 10));
  process.exit(1);
}
console.log("PASS: layout smoke");
