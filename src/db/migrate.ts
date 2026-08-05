import { sql } from "drizzle-orm";
import type { Db } from "./index";

function tableNames(result: unknown): Set<string> {
  const names = new Set<string>();
  const rows =
    (result as { rows?: { table_name: string }[] }).rows ??
    (Array.isArray(result) ? (result as { table_name: string }[]) : []);
  for (const r of rows) {
    if (r?.table_name) names.add(r.table_name);
  }
  return names;
}

/** Create graph tables if they don't exist (used by PGlite local mode). */
export async function ensureSchema(db: Db): Promise<void> {
  const existing = await db.execute(sql`
    select table_name from information_schema.tables
    where table_schema = 'public'
  `);
  const names = tableNames(existing);

  if (!names.has("nodes")) {
    await db.execute(sql`
      create table nodes (
        id text primary key,
        msc_code text,
        wikidata_qid text,
        type text not null,
        title text not null,
        summary text,
        wikipedia_url text,
        thumbnail_url text,
        depth integer not null,
        parent_id text
      )
    `);
    await db.execute(sql`create index nodes_parent_idx on nodes (parent_id)`);
    await db.execute(sql`create index nodes_msc_idx on nodes (msc_code)`);
    await db.execute(sql`create index nodes_depth_idx on nodes (depth)`);
  }

  if (!names.has("edges")) {
    await db.execute(sql`
      create table edges (
        id integer primary key generated always as identity,
        source text not null,
        target text not null,
        type text not null,
        note text
      )
    `);
    await db.execute(sql`create index edges_source_idx on edges (source)`);
    await db.execute(sql`create index edges_target_idx on edges (target)`);
    await db.execute(sql`create index edges_type_idx on edges (type)`);
  } else {
    // column added after the initial release
    await db.execute(sql`alter table edges add column if not exists note text`);
  }

  // Legacy account/document tables — drop if present from older installs.
  if (names.has("document_nodes")) {
    await db.execute(sql`drop table if exists document_nodes`);
  }
  if (names.has("documents")) {
    await db.execute(sql`drop table if exists documents`);
  }
  if (names.has("user_node_state")) {
    await db.execute(sql`drop table if exists user_node_state`);
  }
}
