import type { NodeIndex } from "./graphStore";

/**
 * Expansion-driven radial layout.
 *
 * The 8 grand branches sit as large labeled bubbles on a ring around the
 * center. Expanding a node "pops" it slightly outward and fans its children
 * across a generous arc one ring further out, so the open section fills the
 * free space. Several sections can be open at once: each expanded node's fan
 * is clamped so it doesn't invade the arc of its nearest expanded sibling.
 *
 * Derivation still reads center-outward:
 *   - within an expanded section, axioms sit on the arc *inside* their
 *     parent's ring, theorems outside it (deeper derivation levels further
 *     out), conjectures on the outermost row;
 *   - when a selected result reveals its dependency chain, off-tree chain
 *     members are placed on inner "ghost" rings — axioms near the very
 *     center, each derivation step one ring outward.
 */
export const RADII = {
  ring: 330,
  /** how far an expanded bubble pops out of its ring */
  pop: 80,
  /** ring radius for the children of an expanded node, by parent depth */
  childRing: [660, 920, 1130, 1300] as number[],
  /** ghost rings for revealed dependency-chain nodes (axiom = center) */
  ghostBase: 120,
  ghostStep: 150,
  max: 1500,
};

/** angular span for the children fan, by parent depth */
const CHILD_SPAN = [2.4, 1.7, 1.3, 1.0];
/** arc spacing between sibling bubbles (graph units), by child depth-ish */
const SPACING = [0, 135, 95, 65, 46];
const ROW_GAP = [0, 130, 95, 70, 55];

export interface LayoutResult {
  positions: Map<string, { x: number; y: number }>;
  levels: Map<string, number>;
}

/** derivation levels in the depends-on DAG (axioms = 0) */
export function computeLevels(index: NodeIndex): Map<string, number> {
  const levels = new Map<string, number>();
  const visiting = new Set<string>();
  const levelOf = (id: string): number => {
    const cached = levels.get(id);
    if (cached !== undefined) return cached;
    if (index.byId.get(id)?.type === "axiom") {
      levels.set(id, 0);
      return 0;
    }
    if (visiting.has(id)) return 1; // cycle guard (the data is not a clean DAG)
    visiting.add(id);
    let v = 1;
    for (const dep of index.depsOf.get(id) ?? []) v = Math.max(v, levelOf(dep) + 1);
    visiting.delete(id);
    levels.set(id, v);
    return v;
  };
  for (const id of index.depsOf.keys()) levelOf(id);
  for (const id of index.dependentsOf.keys()) levelOf(id);
  for (const n of index.byId.values()) if (n.type === "axiom") levels.set(n.id, 0);
  return levels;
}

/** Fan `items` across rows of an arc centered on `centerAngle`. */
function arcRows(
  out: Map<string, { x: number; y: number }>,
  items: string[],
  centerAngle: number,
  span: number,
  baseRadius: number,
  spacing: number,
  rowGap: number,
  direction: 1 | -1 = 1,
) {
  let idx = 0;
  let row = 0;
  while (idx < items.length) {
    const r = Math.max(60, baseRadius + direction * row * rowGap);
    const perRow = Math.max(1, Math.floor((span * r) / spacing));
    const n = Math.min(perRow, items.length - idx);
    // keep sibling gaps constant instead of stretching a short row
    const rowSpan = n > 1 ? span * ((n - 1) / Math.max(perRow - 1, 1)) : 0;
    for (let k = 0; k < n; k++) {
      const a = centerAngle + (n === 1 ? 0 : (k / (n - 1) - 0.5) * rowSpan);
      out.set(items[idx + k], { x: r * Math.cos(a), y: r * Math.sin(a) });
    }
    idx += n;
    row++;
  }
}

export function computeLayout(
  index: NodeIndex,
  expanded: Set<string>,
  chainIds: Set<string>,
  levels: Map<string, number>,
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();

  const branches = [...index.byId.values()]
    .filter((n) => n.depth === 0)
    .map((n) => n.id)
    .sort();
  const sector = (2 * Math.PI) / Math.max(branches.length, 1);
  const branchAngle = new Map<string, number>();
  branches.forEach((id, i) => branchAngle.set(id, -Math.PI / 2 + i * sector));

  /** entity ordering: axioms in, then theorems by derivation depth, conjectures out */
  const entitySort = (id: string): number => {
    const n = index.byId.get(id);
    if (!n) return 500;
    if (n.type === "axiom") return 0;
    if (n.type === "conjecture") return 400;
    const level = levels.get(id);
    return level !== undefined ? level : 200;
  };

  const place = (
    id: string,
    angle: number,
    radius: number,
    depth: number,
    allowedSpan: number,
  ) => {
    const popped = expanded.has(id);
    const r = popped ? radius + RADII.pop : radius;
    positions.set(id, { x: r * Math.cos(angle), y: r * Math.sin(angle) });
    if (!popped) return;

    const kids = index.children.get(id) ?? [];
    if (kids.length === 0) return;
    const childRing = RADII.childRing[Math.min(depth, RADII.childRing.length - 1)];
    const span = Math.min(CHILD_SPAN[Math.min(depth, CHILD_SPAN.length - 1)], allowedSpan);

    // taxonomy children (fields/subfields/topics) vs leaf entities
    const taxonomy = kids.filter((k) => (index.byId.get(k)?.depth ?? 4) < 4);
    const axioms = kids.filter((k) => index.byId.get(k)?.type === "axiom");
    const entities = kids
      .filter((k) => (index.byId.get(k)?.depth ?? 4) >= 4 && index.byId.get(k)?.type !== "axiom")
      .sort((a, b) => entitySort(a) - entitySort(b));

    const childDepth = Math.min(depth + 1, SPACING.length - 1);

    // axioms hug the inner side of their section — foundations point inward
    if (axioms.length > 0) {
      arcRows(positions, axioms, angle, span * 0.7, childRing - 150, 70, 60, -1);
    }

    // taxonomy bubbles on the main children ring; recurse into expanded ones,
    // clamping each fan so it can't invade an expanded sibling's arc
    if (taxonomy.length > 0) {
      arcRows(positions, taxonomy, angle, span, childRing, SPACING[childDepth], ROW_GAP[childDepth]);
      const open = taxonomy
        .filter((t) => expanded.has(t))
        .map((t) => {
          const p = positions.get(t)!;
          return { id: t, angle: Math.atan2(p.y, p.x), radius: Math.hypot(p.x, p.y) };
        })
        .sort((a, b) => a.angle - b.angle);
      for (let i = 0; i < open.length; i++) {
        const o = open[i];
        let gap = Infinity;
        if (open.length > 1) {
          const prev = open[(i - 1 + open.length) % open.length];
          const next = open[(i + 1) % open.length];
          const d = (a: number, b: number) => {
            let x = Math.abs(a - b) % (2 * Math.PI);
            return x > Math.PI ? 2 * Math.PI - x : x;
          };
          gap = Math.min(d(o.angle, prev.angle), d(o.angle, next.angle));
        }
        place(o.id, o.angle, o.radius, depth + 1, Math.min(span, 0.9 * gap));
      }
    }

    // theorems/conjectures fan outward beyond the taxonomy ring
    if (entities.length > 0) {
      const taxRows = taxonomy.length > 0
        ? Math.ceil(taxonomy.length / Math.max(1, Math.floor((span * childRing) / SPACING[childDepth])))
        : 0;
      const entityBase = childRing + taxRows * ROW_GAP[childDepth] + (taxonomy.length > 0 ? 40 : 0);
      arcRows(positions, entities, angle, span, entityBase, SPACING[4], ROW_GAP[4]);
    }
  };

  // branches: clamp each expanded fan by the gap to its nearest expanded
  // neighbor on the ring, so several branches can be open at once
  const openBranches = branches.filter((id) => expanded.has(id));
  const branchSpan = new Map<string, number>();
  for (const id of openBranches) {
    let gap = Infinity;
    if (openBranches.length > 1) {
      const a = branchAngle.get(id)!;
      for (const other of openBranches) {
        if (other === id) continue;
        let d = Math.abs(branchAngle.get(other)! - a) % (2 * Math.PI);
        if (d > Math.PI) d = 2 * Math.PI - d;
        gap = Math.min(gap, d);
      }
    }
    branchSpan.set(id, Math.min(CHILD_SPAN[0], 0.9 * gap));
  }
  for (const id of branches) {
    place(id, branchAngle.get(id)!, RADII.ring, 0, branchSpan.get(id) ?? CHILD_SPAN[0]);
  }

  // ---- ghost rings for revealed dependency-chain members --------------------
  // Chain nodes whose parents aren't expanded still need a spot: axioms near
  // the very center, each derivation step one ring outward, kept in their
  // branch's direction so cross-branch dependencies read as chords.
  for (const id of chainIds) {
    if (positions.has(id)) continue;
    const n = index.byId.get(id);
    if (!n) continue;
    const branchId = index.branchOf.get(id);
    const baseAngle = branchAngle.get(branchId ?? "") ?? 0;
    // deterministic small angular offset so chain members don't stack
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
    const angle = baseAngle + (((h >>> 0) % 1000) / 1000 - 0.5) * sector * 0.8;
    const level = levels.get(id);
    let r: number;
    if (n.type === "axiom") r = RADII.ghostBase;
    else if (level !== undefined) r = RADII.ghostBase + level * RADII.ghostStep;
    else if (n.type === "conjecture") r = RADII.ghostBase + 5 * RADII.ghostStep;
    else r = RADII.ghostBase + 3 * RADII.ghostStep;
    positions.set(id, { x: r * Math.cos(angle), y: r * Math.sin(angle) });
  }

  return positions;
}
