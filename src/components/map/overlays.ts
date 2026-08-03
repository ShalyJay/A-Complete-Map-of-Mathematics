import type { NodeIndex } from "./graphStore";
import { mixToward } from "./graphStore";
import type { DocumentNodeLite, UserNodeStateLite } from "@/lib/types";

const UNEXPLORED = "#333f52";

/**
 * Mastery overlay: each node is colored by the average mastery of explicitly
 * marked nodes in its subtree (including itself). Problem areas pull the color
 * toward red. Subtrees with no marks stay gray, so blindspots are obvious.
 */
export function computeMasteryColors(
  index: NodeIndex,
  states: UserNodeStateLite[],
): Map<string, string> {
  const stateBy = new Map(states.map((s) => [s.nodeId, s]));
  const colors = new Map<string, string>();
  // aggregate: [sum mastery, count, problemCount]
  const agg = new Map<string, [number, number, number]>();

  const visit = (id: string): [number, number, number] => {
    const cached = agg.get(id);
    if (cached) return cached;
    let sum = 0,
      count = 0,
      problems = 0;
    const own = stateBy.get(id);
    if (own) {
      sum += own.mastery;
      count += 1;
      if (own.isProblemArea) problems += 1;
    }
    for (const kid of index.children.get(id) ?? []) {
      const [s, c, p] = visit(kid);
      sum += s;
      count += c;
      problems += p;
    }
    const result: [number, number, number] = [sum, count, problems];
    agg.set(id, result);
    return result;
  };

  for (const n of index.byId.values()) {
    const [sum, count, problems] = visit(n.id);
    if (count === 0) {
      colors.set(n.id, UNEXPLORED);
      continue;
    }
    const t = sum / count / 5; // 0..1
    // red -> amber -> green ramp
    const ramp =
      t < 0.5
        ? mixToward("#dc2626", "#f59e0b", t * 2)
        : mixToward("#f59e0b", "#22c55e", (t - 0.5) * 2);
    const problemFrac = problems / count;
    colors.set(n.id, problemFrac > 0 ? mixToward(ramp, "#ef4444", Math.min(1, problemFrac * 1.5)) : ramp);
  }
  return colors;
}

/** Document coverage heatmap: gray -> hot orange by weight. */
export function computeHeatColors(
  index: NodeIndex,
  docNodes: DocumentNodeLite[],
): Map<string, string> {
  const colors = new Map<string, string>();
  const weightBy = new Map(docNodes.map((d) => [d.nodeId, d.weight]));
  for (const n of index.byId.values()) {
    const w = weightBy.get(n.id);
    if (!w) {
      colors.set(n.id, UNEXPLORED);
    } else {
      colors.set(n.id, mixToward("#493a2c", "#fb923c", Math.min(1, Math.pow(w, 0.6))));
    }
  }
  return colors;
}
