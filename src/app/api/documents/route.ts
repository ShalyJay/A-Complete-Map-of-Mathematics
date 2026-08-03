import { NextResponse } from "next/server";
import { desc, eq, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { getUserId } from "@/lib/supabase/server";
import { classifyDocument, storeClassifications } from "@/lib/analysis";
import type { DocumentLite } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET() {
  const userId = await getUserId();
  const db = await getDb();
  const rows = await db
    .select({
      id: schema.documents.id,
      title: schema.documents.title,
      kind: schema.documents.kind,
      status: schema.documents.status,
      createdAt: schema.documents.createdAt,
    })
    .from(schema.documents)
    .where(
      userId
        ? or(eq(schema.documents.userId, userId), isNull(schema.documents.userId))
        : isNull(schema.documents.userId),
    )
    .orderBy(desc(schema.documents.createdAt))
    .limit(50);

  const documents: DocumentLite[] = rows.map((r) => ({
    id: r.id,
    title: r.title,
    kind: r.kind,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
  }));
  return NextResponse.json({ documents });
}

const metaSchema = z.object({
  title: z.string().min(1).max(300),
  kind: z.enum(["paper", "course", "exam", "other"]),
  text: z.string().max(200_000).optional(),
});

async function extractPdfText(buf: ArrayBuffer): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const result = await extractText(pdf, { mergePages: true });
  const text = result.text as string | string[];
  return Array.isArray(text) ? text.join("\n") : text;
}

export async function POST(req: Request) {
  const userId = await getUserId();
  const contentType = req.headers.get("content-type") ?? "";
  let title: string;
  let kind: "paper" | "course" | "exam" | "other";
  let text: string;
  let storagePath: string | null = null;

  if (contentType.includes("multipart/form-data")) {
    const form = await req.formData();
    const parsed = metaSchema.safeParse({
      title: form.get("title"),
      kind: form.get("kind"),
      text: form.get("text") || undefined,
    });
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid form" }, { status: 400 });
    }
    title = parsed.data.title;
    kind = parsed.data.kind;
    const file = form.get("file");
    if (file instanceof File && file.size > 0) {
      if (file.size > 15 * 1024 * 1024) {
        return NextResponse.json({ error: "File too large (15 MB max)" }, { status: 400 });
      }
      const buf = await file.arrayBuffer();
      const name = file.name.toLowerCase();
      if (name.endsWith(".pdf") || file.type === "application/pdf") {
        text = await extractPdfText(buf);
      } else {
        text = new TextDecoder().decode(buf);
      }
      const fs = await import("node:fs/promises");
      const path = await import("node:path");
      const dir = path.join(process.cwd(), ".data", "uploads");
      await fs.mkdir(dir, { recursive: true });
      const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
      storagePath = path.join(dir, `${Date.now()}-${safe}`);
      await fs.writeFile(storagePath, Buffer.from(buf));
    } else if (parsed.data.text?.trim()) {
      text = parsed.data.text;
    } else {
      return NextResponse.json({ error: "Provide a file or text" }, { status: 400 });
    }
  } else {
    const parsed = metaSchema.safeParse(await req.json());
    if (!parsed.success || !parsed.data.text?.trim()) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }
    title = parsed.data.title;
    kind = parsed.data.kind;
    text = parsed.data.text;
  }

  text = text.replace(/\s+/g, " ").trim();
  if (text.length < 40) {
    return NextResponse.json(
      { error: "Not enough text to analyze (need ~40+ characters)" },
      { status: 400 },
    );
  }

  const db = await getDb();
  const [doc] = await db
    .insert(schema.documents)
    .values({
      userId: userId ?? null,
      title,
      kind,
      storagePath,
      status: "processing",
    })
    .returning({ id: schema.documents.id });

  try {
    const classifications = await classifyDocument(text, kind, title);
    const n = await storeClassifications(doc.id, classifications);
    await db
      .update(schema.documents)
      .set({ status: "done", error: null })
      .where(eq(schema.documents.id, doc.id));
    return NextResponse.json({ id: doc.id, status: "done", classified: n });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(schema.documents)
      .set({ status: "error", error: message })
      .where(eq(schema.documents.id, doc.id));
    return NextResponse.json(
      { id: doc.id, status: "error", error: message },
      { status: 500 },
    );
  }
}
