import { NextResponse } from "next/server";
import { eq, or, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { NodeDetail } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: rawId } = await params;
  const id = decodeURIComponent(rawId);
  const db = await getDb();

  const [node] = await db
    .select()
    .from(schema.nodes)
    .where(eq(schema.nodes.id, id))
    .limit(1);
  if (!node) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const relEdges = await db
    .select()
    .from(schema.edges)
    .where(or(eq(schema.edges.source, id), eq(schema.edges.target, id)));

  const neighborIds = new Set<string>();
  for (const e of relEdges) {
    neighborIds.add(e.source === id ? e.target : e.source);
  }
  neighborIds.delete(id);

  const neighbors = neighborIds.size
    ? await db
        .select({
          id: schema.nodes.id,
          title: schema.nodes.title,
          type: schema.nodes.type,
          parentId: schema.nodes.parentId,
        })
        .from(schema.nodes)
        .where(inArray(schema.nodes.id, [...neighborIds]))
    : [];
  const byId = new Map(neighbors.map((n) => [n.id, n]));

  const connections: NodeDetail["connections"] = [];
  const seen = new Set<string>();
  for (const e of relEdges) {
    const otherId = e.source === id ? e.target : e.source;
    const other = byId.get(otherId);
    if (!other || seen.has(otherId)) continue;
    seen.add(otherId);
    let relation: string;
    if (e.type === "child-of") {
      relation = e.source === id ? "parent" : "child";
    } else {
      relation = e.type;
    }
    connections.push({ id: other.id, title: other.title, type: other.type, relation });
  }
  // parents/children first, then cross-references
  const order: Record<string, number> = { parent: 0, child: 1, "see-also": 2, related: 3 };
  connections.sort((a, b) => (order[a.relation] ?? 9) - (order[b.relation] ?? 9));

  const detail: NodeDetail = {
    id: node.id,
    mscCode: node.mscCode,
    wikidataQid: node.wikidataQid,
    type: node.type,
    title: node.title,
    summary: node.summary,
    wikipediaUrl: node.wikipediaUrl,
    thumbnailUrl: node.thumbnailUrl,
    depth: node.depth,
    parentId: node.parentId,
    connections: connections.slice(0, 60),
  };
  return NextResponse.json(detail, {
    headers: { "Cache-Control": "public, max-age=300" },
  });
}
