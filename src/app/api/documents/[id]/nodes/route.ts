import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { getUserId } from "@/lib/supabase/server";
import type { DocumentNodeLite } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const userId = await getUserId();
  const db = await getDb();

  const [doc] = await db
    .select({ id: schema.documents.id, userId: schema.documents.userId })
    .from(schema.documents)
    .where(eq(schema.documents.id, id))
    .limit(1);
  if (!doc) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (doc.userId && doc.userId !== userId) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const rows = await db
    .select({
      nodeId: schema.documentNodes.nodeId,
      weight: schema.documentNodes.weight,
      rationale: schema.documentNodes.rationale,
      direct: schema.documentNodes.direct,
    })
    .from(schema.documentNodes)
    .where(eq(schema.documentNodes.documentId, id));

  return NextResponse.json({ nodes: rows satisfies DocumentNodeLite[] });
}
