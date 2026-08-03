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
    } else if (e.type === "depends-on") {
      // source depends on target: from this node's perspective the other end
      // is either a prerequisite ("builds on") or a dependent ("leads to").
      relation = e.source === id ? "builds-on" : "leads-to";
    } else {
      relation = e.type;
    }

    // why they're connected: use the curated note if the edge has one,
    // otherwise synthesize a sensible sentence from the relation type
    let note = e.note ?? null;
    if (!note) {
      if (relation === "builds-on") {
        note = `The standard proof of ${node.title} makes essential use of ${other.title}.`;
      } else if (relation === "leads-to") {
        note = `${other.title} is proved using ${node.title}.`;
      } else if (relation === "see-also") {
        note = `MSC 2020 cross-references these two classifications: work in one routinely cites the other.`;
      } else if (relation === "related") {
        note = `Listed as related areas in the MSC 2020 classification.`;
      }
    }
    connections.push({ id: other.id, title: other.title, type: other.type, relation, note });
  }
  // derivation links first, then hierarchy, then cross-references
  const order: Record<string, number> = {
    "builds-on": 0,
    "leads-to": 1,
    parent: 2,
    child: 3,
    "see-also": 4,
    related: 5,
  };
  connections.sort((a, b) => (order[a.relation] ?? 9) - (order[b.relation] ?? 9));

  // ---- synthesized description for nodes without one ------------------------
  // Thousands of MSC topics have neither a scope note nor a Wikipedia page;
  // build a useful description from the node's place in the hierarchy instead.
  let summary = node.summary;
  if (!summary || summary.trim().length < 10) {
    const parentEdge = relEdges.find((e) => e.type === "child-of" && e.source === id);
    const parent = parentEdge ? byId.get(parentEdge.target) : undefined;
    const childIds = relEdges
      .filter((e) => e.type === "child-of" && e.target === id)
      .map((e) => e.source);
    const kids = childIds.map((c) => byId.get(c)).filter((n) => n !== undefined);
    const TAXONOMY = ["branch", "field", "subfield", "topic"];
    const kidTax = kids.filter((k) => TAXONOMY.includes(k.type));
    const kidEnt = kids.filter((k) => !TAXONOMY.includes(k.type));

    const LEVEL_WORD: Record<string, string> = {
      branch: "branch of mathematics",
      field: "field",
      subfield: "subfield",
      topic: "topic",
    };
    const parts: string[] = [];
    if (TAXONOMY.includes(node.type)) {
      const where = parent ? ` within ${parent.title}` : "";
      const msc = node.mscCode ? ` It is classified as MSC ${node.mscCode} in the Mathematics Subject Classification.` : "";
      parts.push(`${node.title} is a ${LEVEL_WORD[node.type] ?? "area"}${where}.${msc}`);
      if (kidTax.length > 0) {
        const sample = kidTax.slice(0, 4).map((k) => k.title.toLowerCase()).join(", ");
        parts.push(
          `It spans ${kidTax.length} subtopic${kidTax.length === 1 ? "" : "s"}, including ${sample}.`,
        );
      }
      if (kidEnt.length > 0) {
        const byType = new Map<string, number>();
        for (const k of kidEnt) byType.set(k.type, (byType.get(k.type) ?? 0) + 1);
        const counts = [...byType.entries()]
          .map(([t, n]) => `${n} ${t}${n === 1 ? "" : "s"}`)
          .join(", ");
        const sample = kidEnt.slice(0, 3).map((k) => k.title).join("; ");
        parts.push(`The map places ${counts} directly under it — for example: ${sample}.`);
      }
      if (kidTax.length === 0 && kidEnt.length === 0) {
        parts.push(
          "A specialist classification with no named results attached yet — see its cross-references and parent area for context.",
        );
      }
    } else {
      parts.push(
        `${node.title} is a ${node.type}${parent ? ` in ${parent.title}` : ""}. No detailed summary is available yet — see the linked references and its connections below.`,
      );
    }
    summary = parts.join(" ");
  }

  const detail: NodeDetail = {
    id: node.id,
    mscCode: node.mscCode,
    wikidataQid: node.wikidataQid,
    type: node.type,
    title: node.title,
    summary,
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
