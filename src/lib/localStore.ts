/**
 * Browser-only persistence for personal data (mastery + analyzed documents).
 * The math graph itself still lives in local PGlite via the ingest scripts.
 */
import type { DocumentNodeLite, UserNodeStateLite } from "@/lib/types";

const MASTERY_KEY = "mathmap:mastery";
const DOCS_KEY = "mathmap:documents";

export interface LocalDocument {
  id: string;
  title: string;
  kind: string;
  createdAt: string;
  /** Full heatmap weights (direct + propagated ancestors). */
  nodes: DocumentNodeLite[];
  /** Direct hits with titles for the coverage list. */
  coverage: {
    nodeId: string;
    weight: number;
    rationale: string | null;
    title: string;
    type: string;
    mscCode: string | null;
  }[];
}

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(key, JSON.stringify(value));
}

// ---- mastery ----------------------------------------------------------------

export function loadMastery(): UserNodeStateLite[] {
  const map = readJson<Record<string, Omit<UserNodeStateLite, "nodeId">>>(MASTERY_KEY, {});
  return Object.entries(map).map(([nodeId, v]) => ({
    nodeId,
    mastery: v.mastery ?? 0,
    isProblemArea: !!v.isProblemArea,
    notes: v.notes ?? null,
  }));
}

export function saveMasteryEntry(
  nodeId: string,
  patch: { mastery?: number; isProblemArea?: boolean },
): UserNodeStateLite[] {
  const map = readJson<Record<string, Omit<UserNodeStateLite, "nodeId">>>(MASTERY_KEY, {});
  const prev = map[nodeId];
  const next = {
    mastery: patch.mastery ?? prev?.mastery ?? 0,
    isProblemArea: patch.isProblemArea ?? prev?.isProblemArea ?? false,
    notes: prev?.notes ?? null,
  };
  if (next.mastery === 0 && !next.isProblemArea) delete map[nodeId];
  else map[nodeId] = next;
  writeJson(MASTERY_KEY, map);
  return loadMastery();
}

// ---- documents --------------------------------------------------------------

export function loadDocuments(): LocalDocument[] {
  return readJson<LocalDocument[]>(DOCS_KEY, []).sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
}

export function getDocument(id: string): LocalDocument | undefined {
  return loadDocuments().find((d) => d.id === id);
}

export function saveDocument(doc: LocalDocument): LocalDocument[] {
  const docs = loadDocuments().filter((d) => d.id !== doc.id);
  docs.unshift(doc);
  writeJson(DOCS_KEY, docs);
  return docs;
}

export function deleteDocument(id: string): LocalDocument[] {
  const docs = loadDocuments().filter((d) => d.id !== id);
  writeJson(DOCS_KEY, docs);
  return docs;
}

export function newDocumentId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `doc-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}
