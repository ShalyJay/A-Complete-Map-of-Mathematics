/**
 * Tiny local embeddings via @xenova/transformers (Xenova/all-MiniLM-L6-v2).
 * First run downloads ~23 MB into .data/hf-cache; later runs are offline.
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

export const EMBED_MODEL = "Xenova/all-MiniLM-L6-v2";
const CACHE_DIR = path.join(process.cwd(), ".data", "cache");
const INDEX_PATH = path.join(CACHE_DIR, "node-embeddings.json");
const HF_CACHE = path.join(process.cwd(), ".data", "hf-cache");

export type Vector = number[];

interface IndexFile {
  model: string;
  fingerprint: string;
  dim: number;
  nodes: Record<string, { title: string; vector: Vector }>;
}

type Extractor = (
  texts: string | string[],
  opts: { pooling: "mean"; normalize: boolean },
) => Promise<{ data: Float32Array | number[] }>;

let extractorPromise: Promise<Extractor> | null = null;
let memoryIndex: IndexFile | null = null;

async function getExtractor(): Promise<Extractor> {
  if (!extractorPromise) {
    extractorPromise = (async () => {
      const { pipeline, env } = await import("@xenova/transformers");
      env.cacheDir = HF_CACHE;
      env.allowLocalModels = false;
      const pipe = await pipeline("feature-extraction", EMBED_MODEL, {
        quantized: true,
      });
      return pipe as unknown as Extractor;
    })();
  }
  return extractorPromise;
}

export function cosine(a: Vector, b: Vector): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i]! * b[i]!;
  return dot; // vectors are L2-normalized
}

export async function embedTexts(texts: string[]): Promise<Vector[]> {
  if (texts.length === 0) return [];
  const extractor = await getExtractor();
  const out: Vector[] = [];
  const BATCH = 32;
  for (let i = 0; i < texts.length; i += BATCH) {
    const batch = texts.slice(i, i + BATCH);
    for (const text of batch) {
      const result = await extractor(text, { pooling: "mean", normalize: true });
      const data =
        result.data instanceof Float32Array
          ? result.data
          : Float32Array.from(result.data);
      out.push(Array.from(data));
    }
    if (i === 0 || (i / BATCH) % 10 === 0 || i + BATCH >= texts.length) {
      console.log(`  embedded ${Math.min(i + BATCH, texts.length)}/${texts.length}`);
    }
  }
  return out;
}

export function fingerprintNodes(nodes: { id: string; title: string }[]): string {
  const h = createHash("sha1");
  h.update(EMBED_MODEL);
  for (const n of nodes) h.update(`${n.id}\0${n.title}\n`);
  return h.digest("hex");
}

function loadIndexFile(): IndexFile | null {
  if (!fs.existsSync(INDEX_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(INDEX_PATH, "utf8")) as IndexFile;
  } catch {
    return null;
  }
}

function saveIndexFile(index: IndexFile): void {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(INDEX_PATH, JSON.stringify(index));
}

/**
 * Ensure an embedding index exists for the given nodes. Rebuilds when the
 * taxonomy fingerprint (ids + titles + model) changes.
 */
export async function ensureNodeIndex(
  nodes: { id: string; title: string }[],
): Promise<IndexFile> {
  const fp = fingerprintNodes(nodes);
  if (memoryIndex && memoryIndex.fingerprint === fp && memoryIndex.model === EMBED_MODEL) {
    return memoryIndex;
  }
  const disk = loadIndexFile();
  if (disk && disk.fingerprint === fp && disk.model === EMBED_MODEL) {
    memoryIndex = disk;
    return disk;
  }

  console.log(`Building embedding index for ${nodes.length} nodes (${EMBED_MODEL})…`);
  const vectors = await embedTexts(nodes.map((n) => n.title));
  const index: IndexFile = {
    model: EMBED_MODEL,
    fingerprint: fp,
    dim: vectors[0]?.length ?? 384,
    nodes: {},
  };
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i]!;
    index.nodes[n.id] = { title: n.title, vector: vectors[i]! };
  }
  saveIndexFile(index);
  memoryIndex = index;
  console.log(`Embedding index written → ${INDEX_PATH}`);
  return index;
}
