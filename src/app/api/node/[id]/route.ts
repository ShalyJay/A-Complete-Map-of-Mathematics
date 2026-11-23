import { NextResponse } from "next/server";
import { hasStaticGraph, missingGraphMessage, staticNodeDetail } from "@/lib/staticGraph";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: rawId } = await params;
  const id = decodeURIComponent(rawId);
  if (!hasStaticGraph()) {
    return NextResponse.json({ error: missingGraphMessage() }, { status: 503 });
  }
  try {
    const detail = staticNodeDetail(id);
    if (!detail) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(detail, { headers: { "Cache-Control": "public, max-age=300" } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`GET /api/node/${id} failed:`, message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
