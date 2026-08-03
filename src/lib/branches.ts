/**
 * Curated top-level grouping of the 63 MSC 2020 top-level fields into
 * ~9 "grand branches" so the landing view isn't 63 siblings.
 */
export interface GrandBranch {
  id: string; // node id, e.g. "branch:algebra"
  slug: string;
  title: string;
  summary: string;
  /** two-digit MSC top-level prefixes that belong to this branch */
  mscPrefixes: string[];
  /** hex color used on the map */
  color: string;
}

export const GRAND_BRANCHES: GrandBranch[] = [
  {
    id: "branch:foundations",
    slug: "foundations",
    title: "Foundations & General",
    summary:
      "The bedrock of mathematics: logic, set theory, model theory, and proof theory, together with the history of mathematics and mathematics education.",
    mscPrefixes: ["00", "01", "03", "97"],
    color: "#8b5cf6",
  },
  {
    id: "branch:algebra",
    slug: "algebra",
    title: "Algebra",
    summary:
      "The study of algebraic structure: groups, rings, fields, modules, linear algebra, category theory, and the symmetries that organize mathematics.",
    mscPrefixes: ["06", "08", "12", "13", "15", "16", "17", "18", "19", "20", "22"],
    color: "#ef4444",
  },
  {
    id: "branch:number-theory",
    slug: "number-theory",
    title: "Number Theory",
    summary:
      "The properties of integers and beyond: primes, Diophantine equations, algebraic and analytic number theory, and arithmetic geometry.",
    mscPrefixes: ["11"],
    color: "#f59e0b",
  },
  {
    id: "branch:analysis",
    slug: "analysis",
    title: "Analysis",
    summary:
      "The mathematics of the continuous: real and complex analysis, measure theory, differential equations, functional analysis, and dynamical systems.",
    mscPrefixes: [
      "26", "28", "30", "31", "32", "33", "34", "35", "37", "39",
      "40", "41", "42", "43", "44", "45", "46", "47", "49", "58",
    ],
    color: "#3b82f6",
  },
  {
    id: "branch:geometry-topology",
    slug: "geometry-topology",
    title: "Geometry & Topology",
    summary:
      "The study of shape and space: algebraic geometry, differential geometry, manifolds, and the topological properties preserved under deformation.",
    mscPrefixes: ["14", "51", "52", "53", "54", "55", "57"],
    color: "#10b981",
  },
  {
    id: "branch:discrete-cs",
    slug: "discrete-cs",
    title: "Discrete Math & Computer Science",
    summary:
      "Combinatorics, graph theory, algorithms, complexity, and information theory — the mathematics of finite structures and computation.",
    mscPrefixes: ["05", "68", "94"],
    color: "#06b6d4",
  },
  {
    id: "branch:probability-statistics",
    slug: "probability-statistics",
    title: "Probability & Statistics",
    summary:
      "The mathematics of randomness and data: probability theory, stochastic processes, and statistical inference.",
    mscPrefixes: ["60", "62"],
    color: "#ec4899",
  },
  {
    id: "branch:applied",
    slug: "applied",
    title: "Applied & Computational",
    summary:
      "Mathematics in action: numerical analysis, optimization, operations research, mathematical economics, biology, and control theory.",
    mscPrefixes: ["65", "90", "91", "92", "93"],
    color: "#84cc16",
  },
  {
    id: "branch:physics",
    slug: "physics",
    title: "Physics & Mechanics",
    summary:
      "Mathematical physics: mechanics of particles, solids and fluids, thermodynamics, quantum theory, relativity, astronomy, and geophysics.",
    mscPrefixes: ["70", "74", "76", "78", "80", "81", "82", "83", "85", "86"],
    color: "#f97316",
  },
];

const prefixToBranch = new Map<string, GrandBranch>();
for (const b of GRAND_BRANCHES) {
  for (const p of b.mscPrefixes) prefixToBranch.set(p, b);
}

export function branchForMscPrefix(twoDigit: string): GrandBranch | undefined {
  return prefixToBranch.get(twoDigit);
}

export function branchColor(branchId: string): string {
  return GRAND_BRANCHES.find((b) => b.id === branchId)?.color ?? "#94a3b8";
}
