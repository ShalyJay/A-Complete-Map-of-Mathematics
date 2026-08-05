import {
  index,
  integer,
  pgTable,
  text,
} from "drizzle-orm/pg-core";

/**
 * Node types, roughly in order of depth:
 * - branch:    curated grand branch (Algebra, Analysis, ...) — depth 0
 * - field:     MSC top level (2-digit, e.g. 11 Number theory) — depth 1
 * - subfield:  MSC middle level (e.g. 11A) — depth 2
 * - topic:     MSC leaf (e.g. 11A41 Primes) — depth 3
 * - theorem / axiom / conjecture / definition: Wikidata leaf entities — depth 4
 *
 * Personal data (mastery, analyzed documents) lives in the browser's
 * localStorage — only the shared math graph is stored here.
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
