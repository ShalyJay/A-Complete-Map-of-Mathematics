import {
  boolean,
  index,
  integer,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Node types, roughly in order of depth:
 * - branch:    curated grand branch (Algebra, Analysis, ...) — depth 0
 * - field:     MSC top level (2-digit, e.g. 11 Number theory) — depth 1
 * - subfield:  MSC middle level (e.g. 11A) — depth 2
 * - topic:     MSC leaf (e.g. 11A41 Primes) — depth 3
 * - theorem / axiom / conjecture / definition: Wikidata leaf entities — depth 4
 */
export const nodes = pgTable(
  "nodes",
  {
    id: text("id").primaryKey(), // e.g. "branch:algebra", "msc:11A41", "wd:Q11518"
    mscCode: text("msc_code"),
    wikidataQid: text("wikidata_qid"),
    type: text("type").notNull(), // branch | field | subfield | topic | theorem | axiom | conjecture | definition
    title: text("title").notNull(),
    summary: text("summary"),
    wikipediaUrl: text("wikipedia_url"),
    thumbnailUrl: text("thumbnail_url"),
    depth: integer("depth").notNull(),
    parentId: text("parent_id"),
  },
  (t) => [
    index("nodes_parent_idx").on(t.parentId),
    index("nodes_msc_idx").on(t.mscCode),
    index("nodes_depth_idx").on(t.depth),
  ],
);

export const edges = pgTable(
  "edges",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    source: text("source").notNull(),
    target: text("target").notNull(),
    type: text("type").notNull(), // child-of | see-also | related | depends-on
    /** why the two nodes are connected (shown in the detail panel) */
    note: text("note"),
  },
  (t) => [
    index("edges_source_idx").on(t.source),
    index("edges_target_idx").on(t.target),
    index("edges_type_idx").on(t.type),
  ],
);

export const userNodeState = pgTable(
  "user_node_state",
  {
    userId: uuid("user_id").notNull(),
    nodeId: text("node_id").notNull(),
    mastery: integer("mastery").notNull().default(0), // 0–5
    isProblemArea: boolean("is_problem_area").notNull().default(false),
    notes: text("notes"),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.nodeId] }),
    index("uns_user_idx").on(t.userId),
  ],
);

export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id"),
    title: text("title").notNull(),
    kind: text("kind").notNull(), // paper | course | exam | other
    storagePath: text("storage_path"),
    status: text("status").notNull().default("pending"), // pending | processing | done | error
    error: text("error"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("documents_user_idx").on(t.userId)],
);

export const documentNodes = pgTable(
  "document_nodes",
  {
    documentId: uuid("document_id").notNull(),
    nodeId: text("node_id").notNull(),
    weight: real("weight").notNull(), // 0–1, propagated up the tree
    rationale: text("rationale"),
    direct: boolean("direct").notNull().default(true), // false = weight propagated from a descendant
  },
  (t) => [
    primaryKey({ columns: [t.documentId, t.nodeId] }),
    index("dn_doc_idx").on(t.documentId),
  ],
);
