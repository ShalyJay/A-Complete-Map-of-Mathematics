/**
 * Colours of the map. The three roots are the vault's domain maps; each domain has a hue family and
 * every top-level branch of that domain gets its own shade, so neighbouring sectors stay distinct.
 * Data never carries colours: this file is the single source.
 */
export interface DomainInfo {
  id: string; // node id, e.g. "domain:math"
  domain: "math" | "physics" | "cs";
  title: string;
  color: string;
}

export const DOMAINS: DomainInfo[] = [
  { id: "domain:math", domain: "math", title: "Mathematics", color: "#6366f1" },
  { id: "domain:physics", domain: "physics", title: "Physics", color: "#f59e0b" },
  { id: "domain:cs", domain: "cs", title: "Computer Science & AI", color: "#10b981" },
];

const FAMILIES: Record<string, string[]> = {
  "domain:math": ["#8b5cf6", "#3b82f6", "#ec4899", "#6366f1", "#a855f7", "#0ea5e9", "#d946ef", "#60a5fa", "#c084fc", "#818cf8", "#f472b6", "#38bdf8", "#7c3aed", "#2563eb", "#db2777", "#4f46e5"],
  "domain:physics": ["#f59e0b", "#ef4444", "#f97316", "#eab308", "#fb7185", "#d97706", "#facc15", "#dc2626", "#fb923c", "#fbbf24", "#f43f5e", "#ea580c", "#fcd34d", "#b91c1c", "#fdba74", "#e11d48"],
  "domain:cs": ["#10b981", "#14b8a6", "#22c55e", "#06b6d4", "#84cc16", "#34d399", "#2dd4bf", "#4ade80", "#22d3ee", "#a3e635", "#059669", "#0d9488", "#16a34a", "#0891b2", "#65a30d", "#6ee7b7"],
};

export const domainColor = (rootId: string | undefined): string =>
  DOMAINS.find((d) => d.id === rootId)?.color ?? "#94a3b8";

/**
 * Colour of a top-level branch: its domain's family, indexed by the branch's position among its
 * siblings (sorted ids, so it is stable across reloads).
 */
export function branchShade(rootId: string, branchId: string, siblings: string[]): string {
  const family = FAMILIES[rootId];
  if (!family) return domainColor(rootId);
  const i = [...siblings].sort().indexOf(branchId);
  return i < 0 ? domainColor(rootId) : family[i % family.length];
}
