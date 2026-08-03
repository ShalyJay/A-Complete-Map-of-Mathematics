import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { getUserId } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

async function canAccess(documentId: string, userId: string | null) {
  const db = await getDb();
  const [doc] = await db
    .select()
    .from(schema.documents)
    .where(eq(schema.documents.id, documentId))
    .limit(1);
  if (!doc) return null;
  if (doc.userId && doc.userId !== userId) return null;
  return doc;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const userId = await getUserId();
  const doc = await canAccess(id, userId);
  if (!doc) return NextResponse.json({ error: "not found" }, { status: 404 });

  const db = await getDb();
  const nodes = await db
    .select({
      nodeId: schema.documentNodes.nodeId,
      weight: schema.documentNodes.weight,
      rationale: schema.documentNodes.rationale,
      direct: schema.documentNodes.direct,
      title: schema.nodes.title,
      type: schema.nodes.type,
      mscCode: schema.nodes.mscCode,
    })
    .from(schema.documentNodes)
    .innerJoin(schema.nodes, eq(schema.nodes.id, schema.documentNodes.nodeId))
    .where(
      and(
        eq(schema.documentNodes.documentId, id),
        eq(schema.documentNodes.direct, true),
      ),
    )
    .orderBy(desc(schema.documentNodes.weight));

  return NextResponse.json({
    document: {
      id: doc.id,
      title: doc.title,
      kind: doc.kind,
      status: doc.status,
      error: doc.error,
      createdAt: doc.createdAt.toISOString(),
    },
    coverage: nodes,
  });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const userId = await getUserId();
  const doc = await canAccess(id, userId);
  if (!doc) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (doc.userId && doc.userId !== userId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const db = await getDb();
  await db.delete(schema.documentNodes).where(eq(schema.documentNodes.documentId, id));
  await db.delete(schema.documents).where(eq(schema.documents.id, id));
  return NextResponse.json({ ok: true });
}
