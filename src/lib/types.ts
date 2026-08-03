/** Shared client/server types. */

export interface GraphNodeLite {
  id: string;
  title: string;
  type: string; // branch | field | subfield | topic | theorem | axiom | conjecture | definition
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
   * see-also | related | depends-on (child-of is derived from parentId).
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
  depth: number;
  parentId: string | null;
  connections: {
    id: string;
    title: string;
    type: string;
    relation: string; // builds-on | leads-to | child | parent | see-also | related
    /** why the two nodes are connected (curated or synthesized) */
    note: string | null;
  }[];
}

export interface UserNodeStateLite {
  nodeId: string;
  mastery: number;
  isProblemArea: boolean;
  notes: string | null;
}

export interface DocumentLite {
  id: string;
  title: string;
  kind: string;
  status: string;
  createdAt: string;
}

export interface DocumentNodeLite {
  nodeId: string;
  weight: number;
  rationale: string | null;
  direct: boolean;
}

export type OverlayMode = "none" | "mastery" | { documentId: string };
