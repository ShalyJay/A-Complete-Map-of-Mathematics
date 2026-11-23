/** Shared client/server types. */

export interface GraphNodeLite {
  id: string;
  title: string;
  type: string; // domain | branch | field | subfield | topic | concept | theorem | axiom | conjecture | definition
  depth: number;
  parentId: string | null;
  childCount: number;
  /** secondary line rendered under the title inside big bubbles (e.g. MSC code) */
  sublabel?: string;
}

export interface GraphEdgeLite {
  source: string;
  target: string;
  /**
   * see-also | related | depends-on | bridge (child-of is derived from parentId).
   * For depends-on, source is the dependent result and target its prerequisite.
   */
  type: string;
}

export interface GraphPayload {
  nodes: GraphNodeLite[];
  edges: GraphEdgeLite[];
}

export interface NodeDetail {
  id: string;
  mscCode: string | null;
  wikidataQid: string | null;
  type: string;
  title: string;
  summary: string | null;
  wikipediaUrl: string | null;
  thumbnailUrl: string | null;
  /** Wikipedia's intro as stored in the vault (shown labelled "From Wikipedia") */
  wikipediaExtract: string | null;
  depth: number;
  parentId: string | null;
  domain: "math" | "physics" | "cs";
  codes: { msc?: string; arxiv?: string; acm?: string };
  aliases: string[];
  /** verified Reference block from the vault (Markdown with $math$; `node:<id>` links navigate in-app) */
  reference: string | null;
  verified: string | null;
  researchScore: number | null;
  connections: {
    id: string;
    title: string;
    type: string;
    /** builds-on | leads-to | child | parent | bridge | a vault Connections relation | see also (MSC) | … */
    relation: string;
    /** why the two nodes are connected (vault prereq note or bridge explanation) */
    note: string | null;
    /** bridges: the plain-language principle both ends share */
    principle: string | null;
    principleStatement: string | null;
    sourceUrl: string | null;
    flag: string | null;
  }[];
}

export interface UserNodeStateLite {
  nodeId: string;
  mastery: number;
  isProblemArea: boolean;
  notes: string | null;
}

export interface DocumentNodeLite {
  nodeId: string;
  weight: number;
  rationale: string | null;
  direct: boolean;
}

export type OverlayMode = "none" | "mastery" | { documentId: string };
