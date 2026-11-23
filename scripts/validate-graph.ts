/**
 * The site's graph judge (runs as `prebuild`, so a bad graph fails the deploy and the last good one
 * stays live). Checks data/vault/ after mapping it to the site model:
 *  - the export version is supported, IDs are unique, every parent and edge endpoint exists
 *    (buildSiteGraph throws otherwise), childCount and depth are derived from parents;
 *  - zero cyclic depends-on edges (dependent -> prerequisite);
 *  - node count equals the export's, every Reference block belongs to a node;
 *  - the /api/graph payload stays under the size budget.
 */
import fs from "node:fs";
import path from "node:path";
import { buildSiteGraph, type VaultExport } from "../src/lib/vaultGraph";
import { toPayload } from "../src/lib/staticGraph";

const PAYLOAD_BUDGET = 3.5 * 1024 * 1024;
const KNOWN_TYPES = new Set(["domain", "branch", "field", "subfield", "topic", "concept", "theorem", "axiom", "conjecture", "definition"]);
const dir = path.join(process.cwd(), "data", "vault");
const problems: string[] = [];

const exp = JSON.parse(fs.readFileSync(path.join(dir, "graph.json"), "utf8")) as VaultExport;
const g = buildSiteGraph(exp);
if (g.nodes.length !== exp.nodes.length) problems.push(`node count ${g.nodes.length} != export ${exp.nodes.length}`);
const kids = new Map<string, number>();
for (const n of g.nodes) if (n.parentId) kids.set(n.parentId, (kids.get(n.parentId) ?? 0) + 1);
for (const n of g.nodes) {
  if (!KNOWN_TYPES.has(n.type)) problems.push(`unknown node type ${n.type} (${n.id})`);
  if ((kids.get(n.id) ?? 0) !== n.childCount) problems.push(`childCount of ${n.id}`);
}
if (g.nodes.filter((n) => n.parentId === null).some((n) => n.type !== "domain")) problems.push("a non-root node has no parent");

const deps = new Map<string, string[]>();
for (const e of g.edges) if (e.type === "depends-on") deps.set(e.source, [...(deps.get(e.source) ?? []), e.target]);
const state = new Map<string, 1 | 2>();
const cyclic = (id: string): boolean => {
  state.set(id, 1);
  for (const p of deps.get(id) ?? []) {
    if (state.get(p) === 1 || (!state.has(p) && cyclic(p))) return true;
  }
  state.set(id, 2);
  return false;
};
for (const id of deps.keys()) if (!state.has(id) && cyclic(id)) problems.push(`depends-on cycle through ${id}`);

const refs = JSON.parse(fs.readFileSync(path.join(dir, "references.json"), "utf8")) as { references: Record<string, string> };
for (const key of Object.keys(refs.references)) if (!g.byKey.has(key)) problems.push(`reference for unknown node ${key}`);

const size = Buffer.byteLength(JSON.stringify(toPayload(g)));
if (size > PAYLOAD_BUDGET) problems.push(`/api/graph payload ${(size / 1e6).toFixed(2)} MB over budget`);

const count = (t: string) => g.edges.filter((e) => e.type === t).length;
console.log(
  `${g.nodes.length} nodes, ${count("depends-on")} depends-on, ${count("related")} related, ${count("bridge")} bridge, ` +
    `${count("see-also")} see-also; ${Object.keys(refs.references).length} references; payload ${(size / 1e6).toFixed(2)} MB`,
);
if (problems.length) {
  console.error(`FAIL: ${problems.length} problem(s)`);
  for (const p of problems.slice(0, 40)) console.error("  -", p);
  process.exit(1);
}
console.log("PASS: graph valid");
