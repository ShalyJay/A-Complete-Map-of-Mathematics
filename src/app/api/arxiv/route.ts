import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { searchArxiv } from "@/lib/arxiv";
import {
  shouldUseStaticGraph,
  staticGraphRequiredMessage,
} from "@/lib/graphAccess";
import { hasStaticGraph, loadStaticGraph } from "@/lib/staticGraph";

export const dynamic = "force-dynamic";

async function resolveNode(
  id: string,
): Promise<{ title: string; type: string } | null> {
  if (shouldUseStaticGraph() || hasStaticGraph()) {
    try {
      const g = loadStaticGraph();
      const n = g.nodes.find((x) => x.id === id);
      if (n) return { title: n.title, type: n.type };
    } catch {
      /* fall through to DB */
    }
  }
  if (shouldUseStaticGraph() && !hasStaticGraph()) return null;

  try {
    const db = await getDb();
    const [node] = await db
      .select({ title: schema.nodes.title, type: schema.nodes.type })
      .from(schema.nodes)
      .where(eq(schema.nodes.id, id))
      .limit(1);
    return node ?? null;
  } catch {
    return null;
  }
}

/**
 * GET /api/arxiv?nodeId=wd:Q…   — papers related to a map node
 * GET /api/arxiv?q=…&type=theorem — free-form (debug / future use)
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const nodeId = url.searchParams.get("nodeId");
  const q = url.searchParams.get("q");
  const typeParam = url.searchParams.get("type") ?? "topic";
  const max = Number(url.searchParams.get("max") ?? "8");

  try {
    let title: string | null = null;
    let type = typeParam;

    if (nodeId) {
      const node = await resolveNode(decodeURIComponent(nodeId));
      if (!node) {
        if (shouldUseStaticGraph() && !hasStaticGraph()) {
          return NextResponse.json(
            { error: staticGraphRequiredMessage() },
            { status: 503 },
          );
        }
        return NextResponse.json({ error: "node not found" }, { status: 404 });
      }
      title = node.title;
      type = node.type;
    } else if (q) {
      title = q;
    } else {
      return NextResponse.json(
        { error: "nodeId or q required" },
        { status: 400 },
      );
    }

    const result = await searchArxiv({ title, type, maxResults: max });
    if (!result) {
      return NextResponse.json(
        {
          query: null,
          total: 0,
          papers: [],
          searchUrl: null,
          skipped: true,
          reason: "Node type is too broad for a useful arXiv query",
        },
        { headers: { "Cache-Control": "public, max-age=3600" } },
      );
    }

    return NextResponse.json(
      { ...result, skipped: false },
      {
        headers: {
          // Browser + CDN can reuse; server also caches in-process.
          "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
        },
      },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("GET /api/arxiv failed:", message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
