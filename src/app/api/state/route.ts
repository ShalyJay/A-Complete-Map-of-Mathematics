import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { getUserId } from "@/lib/supabase/server";
import type { UserNodeStateLite } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ states: [] });
  const db = await getDb();
  const rows = await db
    .select({
      nodeId: schema.userNodeState.nodeId,
      mastery: schema.userNodeState.mastery,
      isProblemArea: schema.userNodeState.isProblemArea,
      notes: schema.userNodeState.notes,
    })
    .from(schema.userNodeState)
    .where(eq(schema.userNodeState.userId, userId));
  return NextResponse.json({ states: rows satisfies UserNodeStateLite[] });
}

const patchSchema = z.object({
  nodeId: z.string().min(1),
  mastery: z.number().int().min(0).max(5).optional(),
  isProblemArea: z.boolean().optional(),
  notes: z.string().max(4000).nullable().optional(),
});

export async function POST(req: Request) {
  const userId = await getUserId();
  if (!userId) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }
  const parsed = patchSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }
  const { nodeId, ...patch } = parsed.data;

  const db = await getDb();
  const [existing] = await db
    .select()
    .from(schema.userNodeState)
    .where(
      and(
        eq(schema.userNodeState.userId, userId),
        eq(schema.userNodeState.nodeId, nodeId),
      ),
    )
    .limit(1);

  const next = {
    mastery: patch.mastery ?? existing?.mastery ?? 0,
    isProblemArea: patch.isProblemArea ?? existing?.isProblemArea ?? false,
    notes: patch.notes === undefined ? (existing?.notes ?? null) : patch.notes,
    updatedAt: new Date(),
  };

  if (existing) {
    if (next.mastery === 0 && !next.isProblemArea && !next.notes) {
      await db
        .delete(schema.userNodeState)
        .where(
          and(
            eq(schema.userNodeState.userId, userId),
            eq(schema.userNodeState.nodeId, nodeId),
          ),
        );
      return NextResponse.json({ ok: true, deleted: true });
    }
    await db
      .update(schema.userNodeState)
      .set(next)
      .where(
        and(
          eq(schema.userNodeState.userId, userId),
          eq(schema.userNodeState.nodeId, nodeId),
        ),
      );
  } else {
    await db.insert(schema.userNodeState).values({ userId, nodeId, ...next });
  }
  return NextResponse.json({ ok: true });
}
