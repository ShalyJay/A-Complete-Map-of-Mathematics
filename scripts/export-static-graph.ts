/**
 * Export the live PGlite/Postgres graph to data/static-graph.json so Vercel
 * (and other serverless hosts) can serve the map without a writable database.
 *
 * Usage: npm run export:graph   (after ingest; stop `next dev` first)
 */
import fs from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { getDb, schema } from "../src/db/index";
import type { StaticGraph, StaticNode } from "../src/lib/staticGraph";

const OUT = path.join(process.cwd(), "data", "static-graph.json");
const MAX_SUMMARY = 2500;

async function main() {
  const db = await getDb();

  const nodeRows = await db
    .select({
      id: schema.nodes.id,
      title: schema.nodes.title,
      type: schema.nodes.type,
      depth: schema.nodes.depth,
      parentId: schema.nodes.parentId,
      mscCode: schema.nodes.mscCode,
      wikidataQid: schema.nodes.wikidataQid,
      summary: schema.nodes.summary,
      wikipediaUrl: schema.nodes.wikipediaUrl,
      thumbnailUrl: schema.nodes.thumbnailUrl,
    })
    .from(schema.nodes);

  const counts = await db.execute(sql`
    select parent_id as id, count(*)::int as n
    from nodes
    where parent_id is not null
    group by parent_id
  `);
  const countRows = (
    Array.isArray(counts) ? counts : (counts as { rows: { id: string; n: number }[] }).rows
  ) as { id: string; n: number }[];
  const childCount = new Map(countRows.map((r) => [r.id, Number(r.n)]));

  const edgeRows = await db
    .select({
      source: schema.edges.source,
      target: schema.edges.target,
      type: schema.edges.type,
      note: schema.edges.note,
    })
    .from(schema.edges);

  const nodes: StaticNode[] = nodeRows.map((n) => ({
    id: n.id,
    title: n.title,
    type: n.type,
    depth: n.depth,
    parentId: n.parentId,
    childCount: childCount.get(n.id) ?? 0,
    mscCode: n.mscCode,
    wikidataQid: n.wikidataQid,
    summary: n.summary
      ? n.summary.length > MAX_SUMMARY
        ? `${n.summary.slice(0, MAX_SUMMARY).trim()}…`
        : n.summary
      : null,
    wikipediaUrl: n.wikipediaUrl,
    thumbnailUrl: n.thumbnailUrl,
  }));

  const payload: StaticGraph = {
    version: 1,
    exportedAt: new Date().toISOString(),
    nodes,
    edges: edgeRows.map((e) => ({
      source: e.source,
      target: e.target,
      type: e.type,
      note: e.note,
    })),
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(payload));
  const mb = (fs.statSync(OUT).size / (1024 * 1024)).toFixed(1);
  console.log(
    `Wrote ${OUT} (${nodes.length} nodes, ${edgeRows.length} edges, ${mb} MB)`,
  );
  console.log("Commit this file and redeploy so Vercel can serve the map.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
