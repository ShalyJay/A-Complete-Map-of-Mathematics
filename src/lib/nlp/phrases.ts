/**
 * Lightweight syntactic phrase extraction via compromise (rule-based POS).
 * No model download — used to turn document text into candidate noun phrases
 * before lexical / embedding matching against the map.
 */
import nlp from "compromise";

const NOISE_PHRASE =
  /^(the|a|an|this|that|these|those|each|every|all|any|some|such|other|same)\b/i;
const STOP_PHRASES = new Set([
  "positive integer",
  "positive integers",
  "positive integer k",
  "every positive integer",
  "every positive integer k",
  "distinct positive integers",
  "real number",
  "real numbers",
  "largest real number",
  "smallest real number",
  "integer",
  "integers",
  "number",
  "numbers",
  "sequence",
  "sequences",
  "function",
  "functions",
  "set",
  "sets",
  "point",
  "points",
  "property",
  "condition",
  "conditions",
  "following condition",
  "following condition for",
  "value",
  "values",
  "minimal value",
  "case",
  "cases",
  "player",
  "players",
  "move",
  "moves",
  "string", // alone too ambiguous (digit strings vs continuum mechanics)
  "strings",
  "new string",
  "matrix",
  "matrices",
  "entry",
  "entries",
  "same color",
  "the same color",
  "legal move",
  "other player wins",
  "alternate moves",
  "that there",
  "all points",
  "all i for",
  "b and c",
  "value of k",
  "minimal value of k",
  "number of integers k",
  "the following condition",
  "smallest real number b",
  "largest real number a",
  "largest real constant r",
]);

/** Phrases that are mostly variables / problem scaffolding. */
const SCAFFOLD =
  /\b(a1|a2|b1|b2|mk|nk|ai|aj|si|xi|f\(s\)|let [a-z]\b|prove that|show that|find the|such that|william lowell|putnam mathematical)\b/i;

function normalizePhrase(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9π\s\-']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function keepPhrase(p: string): boolean {
  if (p.length < 4 || p.length > 80) return false;
  if (NOISE_PHRASE.test(p)) {
    const stripped = p.replace(NOISE_PHRASE, "").trim();
    if (stripped.length < 4) return false;
  }
  const words = p.split(/\s+/).filter(Boolean);
  if (words.length === 0) return false;
  if (words.length === 1) {
    // Single tokens are weak unless distinctive (e.g. "combinatorics").
    if (p.length < 8 || STOP_PHRASES.has(p)) return false;
  }
  if (STOP_PHRASES.has(p)) return false;
  if (SCAFFOLD.test(p)) return false;
  // Drop pure numeric / variable junk left after cleaning.
  if (/^[0-9π\s\-]+$/.test(p)) return false;
  // "positive integer k", "real matrices a1", "smallest real number b"
  if (/\b([a-z]\d{0,4}|\d{1,4})$/i.test(p) && p.split(/\s+/).length <= 5) return false;
  return true;
}

export interface ExtractedPhrases {
  /** Ranked unique noun phrases (most frequent first). */
  phrases: string[];
  /** Counts for weighting. */
  counts: Map<string, number>;
}

/**
 * Extract noun phrases and topical chunks from document text.
 * Caps work on very long docs by sampling the head / middle / tail.
 */
export function extractPhrases(text: string, maxPhrases = 80): ExtractedPhrases {
  const clipped = text.replace(/\s+/g, " ").trim().slice(0, 60_000);
  // Sample windows so long papers don't explode compromise cost.
  const windows: string[] = [];
  if (clipped.length <= 12_000) {
    windows.push(clipped);
  } else {
    windows.push(clipped.slice(0, 5000));
    const mid = Math.floor(clipped.length / 2);
    windows.push(clipped.slice(mid - 2500, mid + 2500));
    windows.push(clipped.slice(-4000));
  }

  const counts = new Map<string, number>();
  const bump = (raw: string, w = 1) => {
    const p = normalizePhrase(raw);
    if (!keepPhrase(p)) return;
    // Prefer de-determinized form for matching ("the centroid" → "centroid").
    const core = p.replace(/^(the|a|an)\s+/, "");
    const key = keepPhrase(core) ? core : p;
    counts.set(key, (counts.get(key) ?? 0) + w);
  };

  for (const win of windows) {
    const doc = nlp(win);
    for (const p of doc.nouns().out("array") as string[]) bump(p);
    // Adjective + noun chunks catch "relatively prime integers", "strictly increasing".
    for (const p of doc.match("#Adjective+ #Noun+").out("array") as string[]) {
      bump(p, 2);
    }
    // Multiword topics often appear as "X of Y" / "X theory".
    for (const p of doc.match("#Noun (of|and) #Noun+").out("array") as string[]) {
      bump(p, 1.5);
    }
  }

  const phrases = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .slice(0, maxPhrases)
    .map(([p]) => p);

  return { phrases, counts };
}
