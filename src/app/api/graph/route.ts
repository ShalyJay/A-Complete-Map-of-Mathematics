import { NextResponse } from "next/server";
import { sql, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { GraphPayload } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Lightweight full-graph payload for the client-side map. */
export async function GET() {
  const db = await getDb();

  const rows = await db.execute(sql`
    select n.id, n.title, n.type, n.depth, n.parent_id,
           (select count(*)::int from nodes c where c.parent_id = n.id) as child_count
    from nodes n
  `);

  const edgeRows = await db
    .select({
      source: schema.edges.source,
      target: schema.edges.target,
      type: schema.edges.type,
    })
    .from(schema.edges)
    .where(inArray(schema.edges.type, ["see-also", "related", "depends-on"]));

  const raw = (Array.isArray(rows) ? rows : (rows as { rows: Record<string, unknown>[] }).rows) as Record<
    string,
    unknown
  >[];
  const nodes = raw.map((r) => ({
    id: r.id as string,
    title: r.title as string,
    type: r.type as string,
    depth: Number(r.depth),
    parentId: (r.parent_id as string | null) ?? null,
    childCount: Number(r.child_count),
  }));

  const payload: GraphPayload = { nodes, edges: edgeRows };
  return NextResponse.json(payload, {
    headers: { "Cache-Control": "public, max-age=300" },
  });
}
