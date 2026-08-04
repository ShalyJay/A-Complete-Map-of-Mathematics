import type { NodeIndex } from "./graphStore";
import { orderBranches } from "./layout";

/**
 * Expansion-driven 3D layout.
 *
 * Same semantics as the 2D radial layout, lifted into space: the 8 grand
 * branches sit on a ring in the equatorial (XY) plane, and expanding a node
 * pops it outward and fans its children across a *spherical cap* around the
 * node's outward direction — so an open section spreads into z as well as
 * x/y and gets a whole shell of room instead of an arc.
 *
 * Derivation still reads center-outward:
 *   - axioms sit on an inner shell (foundations point toward the origin),
 *   - theorems fill shells outward by derivation level,
 *   - conjectures land on the outermost shell,
 *   - revealed dependency-chain members from collapsed branches get "ghost"
 *     spots near the center in their branch's direction.
 */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export const RADII3 = {
  ring: 330,
  /** how far an expanded bubble pops out of its ring */
  pop: 90,
  /** shell radius for the children of an expanded node, by parent depth */
  childShell: [640, 900, 1110, 1280] as number[],
  /** ghost shells for revealed dependency-chain nodes (axiom = center) */
  ghostBase: 110,
  ghostStep: 140,
};

/** half-angle of the children cap, by parent depth */
const CAP = [1.05, 0.78, 0.6, 0.48];
/** desired spacing between leaf entities on a shell (world units) */
const ENTITY_SPACING = 60;
const ENTITY_SHELL_GAP = 130;

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
const normalize = (v: Vec3): Vec3 => {
  const l = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / l, y: v.y / l, z: v.z / l };
};
const scale = (v: Vec3, s: number): Vec3 => ({ x: v.x * s, y: v.y * s, z: v.z * s });
const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const angleBetween = (a: Vec3, b: Vec3): number =>
  Math.acos(Math.min(1, Math.max(-1, dot(a, b))));

/** orthonormal basis perpendicular to d */
function basis(d: Vec3): [Vec3, Vec3] {
  const ref: Vec3 = Math.abs(d.z) < 0.9 ? { x: 0, y: 0, z: 1 } : { x: 1, y: 0, z: 0 };
  const u = normalize(cross(d, ref));
  const v = cross(d, u);
  return [u, v];
}

/**
 * k unit directions spread evenly over a spherical cap of half-angle `cap`
 * around direction `d` (sunflower / golden-spiral distribution).
 */
function capDirections(d: Vec3, cap: number, k: number): Vec3[] {
  if (k <= 1) return [d];
  const [u, v] = basis(d);
  const out: Vec3[] = [];
  for (let i = 0; i < k; i++) {
    const polar = cap * Math.sqrt((i + 0.5) / k);
    const az = i * GOLDEN_ANGLE;
    const sp = Math.sin(polar);
    const cp = Math.cos(polar);
    const ca = Math.cos(az);
    const sa = Math.sin(az);
    out.push({
      x: d.x * cp + (u.x * ca + v.x * sa) * sp,
      y: d.y * cp + (u.y * ca + v.y * sa) * sp,
      z: d.z * cp + (u.z * ca + v.z * sa) * sp,
    });
  }
  return out;
}

export function computeLayout3D(
  index: NodeIndex,
  expanded: Set<string>,
  chainIds: Set<string>,
  levels: Map<string, number>,
): Map<string, Vec3> {
  const positions = new Map<string, Vec3>();

  const branches = orderBranches(index);
  const sector = (2 * Math.PI) / Math.max(branches.length, 1);
  const branchDir = new Map<string, Vec3>();
  branches.forEach((id, i) => {
    const a = -Math.PI / 2 + i * sector;
    branchDir.set(id, { x: Math.cos(a), y: Math.sin(a), z: 0 });
  });

  /** entity ordering: axioms in, then theorems by derivation depth, conjectures out */
  const entitySort = (id: string): number => {
    const n = index.byId.get(id);
    if (!n) return 500;
    if (n.type === "axiom") return 0;
    if (n.type === "conjecture") return 400;
    const level = levels.get(id);
    return level !== undefined ? level : 200;
  };

  /**
   * Direction a node "wants" to sit in to keep its derivation chords short:
   * the mean direction of its dependency partners. Partners not placed yet
   * are approximated by their branch's spot on the ring, so results with
   * cross-branch links drift toward the side facing the other branch.
   */
  const partnerPull = (id: string): Vec3 | null => {
    let sx = 0;
    let sy = 0;
    let sz = 0;
    let n = 0;
    const partners = [
      ...(index.depsOf.get(id) ?? []),
      ...(index.dependentsOf.get(id) ?? []),
    ];
    for (const p of partners) {
      let pos = positions.get(p);
      if (!pos) {
        const bd = branchDir.get(index.branchOf.get(p) ?? "");
        if (bd) pos = scale(bd, RADII3.ring);
      }
      if (!pos) continue;
      sx += pos.x;
      sy += pos.y;
      sz += pos.z;
      n++;
    }
    if (n === 0) return null;
    const len = Math.hypot(sx, sy, sz);
    return len < 1e-6 ? null : { x: sx / len, y: sy / len, z: sz / len };
  };

  /**
   * Hand out cap slots so each item lands as close as possible to the
   * direction its dependency partners pull it toward (greedy assignment;
   * items with a pull pick first).
   */
  const assignSlots = (items: string[], dirs: Vec3[], radius: number) => {
    const free = dirs.map((_, i) => i);
    const pulled = items.map((id) => ({ id, pull: partnerPull(id) }));
    pulled.sort((a, b) => (b.pull ? 1 : 0) - (a.pull ? 1 : 0));
    for (const { id, pull } of pulled) {
      let bestIdx = 0;
      if (pull) {
        let bestScore = -Infinity;
        for (let j = 0; j < free.length; j++) {
          const s = dot(dirs[free[j]], pull);
          if (s > bestScore) {
            bestScore = s;
            bestIdx = j;
          }
        }
      }
      const slot = free.splice(bestIdx, 1)[0];
      positions.set(id, scale(dirs[slot], radius));
    }
  };

  const place = (id: string, dir: Vec3, radius: number, depth: number, allowedCap: number) => {
    const popped = expanded.has(id);
    const r = popped ? radius + RADII3.pop : radius;
    positions.set(id, scale(dir, r));
    if (!popped) return;

    const kids = index.children.get(id) ?? [];
    if (kids.length === 0) return;
    const shell = RADII3.childShell[Math.min(depth, RADII3.childShell.length - 1)];
    const cap = Math.min(CAP[Math.min(depth, CAP.length - 1)], allowedCap);

    const taxonomy = kids.filter((k) => (index.byId.get(k)?.depth ?? 4) < 4);
    const axioms = kids.filter((k) => index.byId.get(k)?.type === "axiom");
    const entities = kids
      .filter((k) => (index.byId.get(k)?.depth ?? 4) >= 4 && index.byId.get(k)?.type !== "axiom")
      .sort((a, b) => entitySort(a) - entitySort(b));

    // axioms hug an inner shell — foundations point toward the origin
    if (axioms.length > 0) {
      const dirs = capDirections(dir, cap * 0.55, axioms.length);
      assignSlots(axioms, dirs, Math.max(90, shell - 180));
    }

    // taxonomy bubbles on the main children shell; recurse into expanded
    // ones, clamping each fan so it can't invade an expanded sibling's cap
    if (taxonomy.length > 0) {
      const dirs = capDirections(dir, cap, taxonomy.length);
      taxonomy.forEach((t, i) => positions.set(t, scale(dirs[i], shell)));
      const open = taxonomy.filter((t) => expanded.has(t));
      for (const o of open) {
        const od = normalize(positions.get(o)!);
        let gap = Infinity;
        for (const other of open) {
          if (other === o) continue;
          gap = Math.min(gap, angleBetween(od, normalize(positions.get(other)!)));
        }
        place(o, od, shell, depth + 1, Math.min(cap, gap * 0.45));
      }
    }

    // theorems/conjectures fill shells outward beyond the taxonomy shell,
    // lower derivation levels first so foundations stay closer to the center
    if (entities.length > 0) {
      const base = shell + (taxonomy.length > 0 ? 170 : 70);
      let idx = 0;
      let layer = 0;
      while (idx < entities.length) {
        const r2 = base + layer * ENTITY_SHELL_GAP;
        const capArea = 2 * Math.PI * r2 * r2 * (1 - Math.cos(cap));
        const per = Math.max(8, Math.floor(capArea / (ENTITY_SPACING * ENTITY_SPACING)));
        const batch = entities.slice(idx, idx + per);
        const dirs = capDirections(dir, cap, batch.length);
        // dependency-aware slots: connected results gravitate toward each
        // other, so the orange chords stay as short as the shells allow
        assignSlots(batch, dirs, r2);
        idx += per;
        layer++;
      }
    }
  };

  // branches: clamp each expanded fan by the angle to its nearest expanded
  // neighbor on the ring, so several branches can be open at once
  const openBranches = branches.filter((id) => expanded.has(id));
  const branchCap = new Map<string, number>();
  for (const id of openBranches) {
    let gap = Infinity;
    if (openBranches.length > 1) {
      const d = branchDir.get(id)!;
      for (const other of openBranches) {
        if (other === id) continue;
        gap = Math.min(gap, angleBetween(d, branchDir.get(other)!));
      }
    }
    branchCap.set(id, Math.min(CAP[0], gap * 0.45));
  }
  for (const id of branches) {
    place(id, branchDir.get(id)!, RADII3.ring, 0, branchCap.get(id) ?? CAP[0]);
  }

  // ---- ghost shells for revealed dependency-chain members --------------------
  // Chain members whose parents aren't expanded still need a spot: axioms near
  // the very center, each derivation step one shell outward, kept roughly in
  // their branch's direction so cross-branch dependencies read as chords.
  for (const id of chainIds) {
    if (positions.has(id)) continue;
    const n = index.byId.get(id);
    if (!n) continue;
    const branchId = index.branchOf.get(id);
    const base = branchDir.get(branchId ?? "") ?? { x: 1, y: 0, z: 0 };
    // deterministic offset (azimuth + out-of-plane tilt) so members don't stack
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
    const t1 = (((h >>> 0) % 1000) / 1000 - 0.5) * sector * 0.8;
    const t2 = ((((h >>> 10) >>> 0) % 1000) / 1000 - 0.5) * 0.9;
    const a = Math.atan2(base.y, base.x) + t1;
    const dir = normalize({
      x: Math.cos(a) * Math.cos(t2),
      y: Math.sin(a) * Math.cos(t2),
      z: Math.sin(t2),
    });
    const level = levels.get(id);
    let r: number;
    if (n.type === "axiom") r = RADII3.ghostBase;
    else if (level !== undefined) r = RADII3.ghostBase + level * RADII3.ghostStep;
    else if (n.type === "conjecture") r = RADII3.ghostBase + 5 * RADII3.ghostStep;
    else r = RADII3.ghostBase + 3 * RADII3.ghostStep;
    positions.set(id, scale(dir, r));
  }

  return positions;
}
