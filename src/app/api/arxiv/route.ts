import { NextResponse } from "next/server";
import { searchArxiv, type ArxivScope } from "@/lib/arxiv";
import { hasStaticGraph, loadStaticGraph, missingGraphMessage } from "@/lib/staticGraph";

export const dynamic = "force-dynamic";

function resolveNode(id: string): { title: string; type: string; scope: ArxivScope } | null {
  const n = loadStaticGraph().byId.get(id);
  return n ? { title: n.title, type: n.type, scope: { domain: n.domain, arxiv: n.codes.arxiv ?? null } } : null;
}

/**
 * GET /api/arxiv?nodeId=wd:Q…   — papers related to a map node
 * GET /api/arxiv?q=…&type=theorem&domain=physics — free-form (debug / future use)
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const nodeId = url.searchParams.get("nodeId");
  const q = url.searchParams.get("q");
  const max = Number(url.searchParams.get("max") ?? "8");

  try {
    let title: string;
    let type = url.searchParams.get("type") ?? "topic";
    let scope: ArxivScope = { domain: (url.searchParams.get("domain") as ArxivScope["domain"]) ?? "math" };

    if (nodeId) {
      if (!hasStaticGraph()) return NextResponse.json({ error: missingGraphMessage() }, { status: 503 });
      const node = resolveNode(decodeURIComponent(nodeId));
      if (!node) return NextResponse.json({ error: "node not found" }, { status: 404 });
      ({ title, type, scope } = node);
    } else if (q) {
      title = q;
    } else {
      return NextResponse.json({ error: "nodeId or q required" }, { status: 400 });
    }

    const result = await searchArxiv({ title, type, scope, maxResults: max });
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
