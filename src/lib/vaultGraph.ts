/**
 * Maps the Personal Wiki vault's export (data/vault/graph.json, written by the vault's
 * `_tools/export_site.py`) to the site's graph model. The vault is the only source of the graph;
 * this file only renames, assigns stable IDs and derives depth / childCount.
 *
 * ID scheme (keeps saved mastery valid where the pre-vault graph had the same object):
 *   roots            domain:math | domain:physics | domain:cs
 *   MSC field        msc:NN-XX     (mscCode "NN-XX", the form the AI classifier expects)
 *   MSC subfield     msc:NNLxx
 *   MSC topic        msc:NNLNN | msc:NN-NN
 *   other maps       <domain>:<structure_id>
 *   concepts         wd:<QID> when the vault records a Wikidata item, else c:<note title>
 */

export interface VaultExportNode {
  key: string;
  level: "domain" | "branch" | "section" | "subsection" | "topic" | "concept";
  domain: "math" | "physics" | "cs";
  label: string;
  parent?: string;
  secondary?: string[];
  structure_id?: string;
  codes?: { msc?: string; arxiv?: string; acm?: string };
  kind?: string;
  summary?: string;
  aliases?: string[];
  wikidata?: string;
  wikipedia?: string;
  thumbnail?: string;
  wikipedia_extract?: string;
  verified?: string;
  research_score?: number;
}

export interface VaultExportEdge {
  type: "prereq" | "connection" | "bridge" | "see-also" | "see-conditionally" | "crosslink";
  source: string;
  target: string;
  note?: string;
  relation?: string;
  principle?: string;
  source_url?: string;
  flag?: string;
}

export interface VaultExport {
  version: number;
  nodes: VaultExportNode[];
  edges: VaultExportEdge[];
  principles: { title: string; statement: string }[];
}

export type Domain = VaultExportNode["domain"];

export interface SiteNode {
  id: string;
  key: string;
  title: string;
  type: string;
  depth: number;
  parentId: string | null;
  childCount: number;
  domain: Domain;
  mscCode: string | null;
  codes: { msc?: string; arxiv?: string; acm?: string };
  wikidataQid: string | null;
  summary: string | null;
  wikipediaUrl: string | null;
  thumbnailUrl: string | null;
  wikipediaExtract: string | null;
  aliases: string[];
  verified: string | null;
  researchScore: number | null;
  secondary: string[];
  sublabel?: string;
}

/** Site edge types: depends-on (source = dependent, target = prerequisite), related, see-also, bridge, child-of. */
export interface SiteEdge {
  source: string;
  target: string;
  type: "depends-on" | "related" | "see-also" | "bridge" | "child-of";
  note: string | null;
  relation: string | null;
  principle: string | null;
  sourceUrl: string | null;
  flag: string | null;
}

export interface SiteGraph {
  nodes: SiteNode[];
  edges: SiteEdge[];
  byId: Map<string, SiteNode>;
  byKey: Map<string, SiteNode>;
  principles: Map<string, string>;
}

export const SUPPORTED_EXPORT_VERSION = 1;

const TYPE_OF_LEVEL: Record<string, string> = {
  domain: "domain",
  branch: "branch",
  section: "field",
  subsection: "subfield",
  topic: "topic",
};

function mscId(n: VaultExportNode): { id: string; code: string } | null {
  const code = n.codes?.msc;
  if (!code || n.domain !== "math" || n.level === "concept") return null;
  if (n.level === "section" && /^\d\d$/.test(code)) return { id: `msc:${code}-XX`, code: `${code}-XX` };
  return { id: `msc:${code}`, code };
}

export function buildSiteGraph(exp: VaultExport): SiteGraph {
  if (exp.version !== SUPPORTED_EXPORT_VERSION) {
    throw new Error(`Unsupported vault export version ${exp.version} (expected ${SUPPORTED_EXPORT_VERSION})`);
  }
  const idOfKey = new Map<string, string>();
  const used = new Set<string>();
  for (const n of exp.nodes) {
    let id: string;
    const msc = mscId(n);
    if (n.level === "domain") id = `domain:${n.domain}`;
    else if (msc) id = msc.id;
    else if (n.level !== "concept") id = `${n.domain}:${n.structure_id ?? n.key}`;
    else if (n.wikidata && !used.has(`wd:${n.wikidata}`)) id = `wd:${n.wikidata}`;
    else id = `c:${n.key}`;
    if (used.has(id)) id = `c:${n.key}`;
    if (used.has(id)) throw new Error(`Duplicate node id ${id}`);
    used.add(id);
    idOfKey.set(n.key, id);
  }
  const resolve = (key: string | undefined): string | null => (key ? idOfKey.get(key) ?? null : null);

  const nodes: SiteNode[] = exp.nodes.map((n) => {
    const msc = mscId(n);
    return {
      id: idOfKey.get(n.key)!,
      key: n.key,
      title: n.level === "concept" ? n.key : n.label,
      type: n.level === "concept" ? n.kind ?? "concept" : TYPE_OF_LEVEL[n.level],
      depth: 0,
      parentId: resolve(n.parent),
      childCount: 0,
      domain: n.domain,
      mscCode: msc?.code ?? (n.level === "concept" ? n.codes?.msc ?? null : null),
      codes: n.codes ?? {},
      wikidataQid: n.wikidata ?? null,
      summary: n.summary ?? null,
      wikipediaUrl: n.wikipedia ?? null,
      thumbnailUrl: n.thumbnail ?? null,
      wikipediaExtract: n.wikipedia_extract ?? null,
      aliases: n.aliases ?? [],
      verified: n.verified ?? null,
      researchScore: n.research_score ?? null,
      secondary: (n.secondary ?? []).map((s) => resolve(s)).filter((s): s is string => !!s),
      sublabel: msc ? `MSC ${msc.code.replace(/-XX$/, "")}` : undefined,
    };
  });
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const byKey = new Map(nodes.map((n) => [n.key, n]));
  for (const n of nodes) {
    if (n.parentId && !byId.has(n.parentId)) throw new Error(`Missing parent ${n.parentId} of ${n.id}`);
    if (n.parentId) byId.get(n.parentId)!.childCount++;
  }
  const depthOf = (n: SiteNode, guard = 0): number => {
    if (!n.parentId) return 0;
    if (guard > 32) throw new Error(`Parent cycle at ${n.id}`);
    return depthOf(byId.get(n.parentId)!, guard + 1) + 1;
  };
  for (const n of nodes) n.depth = depthOf(n);

  const edges: SiteEdge[] = [];
  const edge = (e: Partial<SiteEdge> & Pick<SiteEdge, "source" | "target" | "type">) =>
    edges.push({ note: null, relation: null, principle: null, sourceUrl: null, flag: null, ...e });
  for (const e of exp.edges) {
    const source = resolve(e.source);
    const target = resolve(e.target);
    if (!source || !target) throw new Error(`Dangling ${e.type} edge ${e.source} -> ${e.target}`);
    switch (e.type) {
      case "prereq":
        edge({ source, target, type: "depends-on", note: e.note ?? null });
        break;
      case "connection":
        edge({ source, target, type: "related", relation: e.relation ?? "related" });
        break;
      case "bridge":
        edge({
          source, target, type: "bridge", note: e.note ?? null, principle: e.principle ?? null,
          sourceUrl: e.source_url ?? null, flag: e.flag ?? null,
        });
        break;
      case "see-also":
        edge({ source, target, type: "see-also", relation: "see also (MSC)" });
        break;
      case "see-conditionally":
        edge({ source, target, type: "see-also", relation: "see conditionally (MSC)" });
        break;
      case "crosslink":
        edge({ source, target, type: "related", relation: "related area" });
        break;
    }
  }
  for (const n of nodes) {
    if (n.parentId) edge({ source: n.id, target: n.parentId, type: "child-of" });
    for (const s of n.secondary) edge({ source: n.id, target: s, type: "related", relation: "also filed under" });
  }
  return { nodes, edges, byId, byKey, principles: new Map(exp.principles.map((p) => [p.title, p.statement])) };
}

/** Rewrite `node:<vault title>` links in a Reference block to `node:<site id>` (unknown keys become plain text). */
export function relinkReference(markdown: string, idOfKey: (key: string) => string | null): string {
  return markdown.replace(/\[([^\]]*)\]\(node:([^)]*)\)/g, (_m, label: string, key: string) => {
    const id = idOfKey(decodeURIComponent(key));
    return id ? `[${label}](node:${encodeURIComponent(id)})` : label;
  });
}
