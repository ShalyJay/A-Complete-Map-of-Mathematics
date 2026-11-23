import { NextResponse } from "next/server";
import { hasStaticGraph, missingGraphMessage, staticGraphPayload } from "@/lib/staticGraph";

export const dynamic = "force-dynamic";

/** Lightweight full-graph payload for the client-side map (built from the vault export). */
export async function GET() {
  if (!hasStaticGraph()) {
    return NextResponse.json({ error: missingGraphMessage() }, { status: 503 });
  }
  try {
    return NextResponse.json(staticGraphPayload(), {
      headers: { "Cache-Control": "public, max-age=300" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("GET /api/graph failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
