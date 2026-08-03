import type Graph from "graphology";
import type { NodeIndex } from "./graphStore";

/** Ring radius for children spawned from a parent at the given child depth. */
const RING_RADIUS: Record<number, number> = {
  1: 150,
  2: 48,
  3: 15,
  4: 5,
};

/** Place the 9 grand branches on a circle around the origin. */
export function layoutBranches(graph: Graph, branchIds: string[]): void {
  const R = 420;
  branchIds.forEach((id, i) => {
    const angle = (2 * Math.PI * i) / branchIds.length - Math.PI / 2;
    graph.setNodeAttribute(id, "x", R * Math.cos(angle));
    graph.setNodeAttribute(id, "y", R * Math.sin(angle));
  });
}

/**
 * Place the children of `parentId` on a ring around it.
 * The ring radius grows gently with the number of children so large families
 * don't collapse into a blob.
 */
export function layoutChildren(
  graph: Graph,
  index: NodeIndex,
  parentId: string,
): void {
  const kids = index.children.get(parentId) ?? [];
  if (kids.length === 0) return;
  const px = graph.getNodeAttribute(parentId, "x") as number;
  const py = graph.getNodeAttribute(parentId, "y") as number;
  const depth = (index.byId.get(kids[0])?.depth ?? 1) as number;
  const base = RING_RADIUS[depth] ?? 10;
  const r = base * Math.max(1, Math.sqrt(kids.length / 10));
  // Fan children starting from the direction pointing away from the origin so
  // rings tend to grow outward from the center of the map.
  const away = Math.atan2(py, px);
  kids.forEach((id, i) => {
    const angle = away + (2 * Math.PI * i) / kids.length;
    graph.setNodeAttribute(id, "x", px + r * Math.cos(angle));
    graph.setNodeAttribute(id, "y", py + r * Math.sin(angle));
  });
}
