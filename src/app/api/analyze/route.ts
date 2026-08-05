/**
 * Analyze an uploaded document / pasted text against the map taxonomy.
 * Returns coverage for the client to store in localStorage — no user DB writes.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  classifyByKeywords,
  classifyDocument,
  resolveClassifications,
} from "@/lib/analysis";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const metaSchema = z.object({
  title: z.string().min(1).max(300),
  kind: z.enum(["paper", "course", "exam", "other"]),
  text: z.string().max(200_000).optional(),
  method: z.enum(["keyword", "llm"]).default("keyword"),
  apiKey: z.string().max(300).optional(),
});

async function extractPdfText(buf: ArrayBuffer): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const result = await extractText(pdf, { mergePages: true });
  const text = result.text as string | string[];
  return Array.isArray(text) ? text.join("\n") : text;
}

export async function GET() {
  return NextResponse.json({
    llmConfigured: !!process.env.ANTHROPIC_API_KEY,
  });
}

export async function POST(req: Request) {
  const contentType = req.headers.get("content-type") ?? "";
  let title: string;
  let kind: "paper" | "course" | "exam" | "other";
  let method: "keyword" | "llm";
  let apiKey: string | undefined;
  let text: string;

  if (contentType.includes("multipart/form-data")) {
    const form = await req.formData();
    const parsed = metaSchema.safeParse({
      title: form.get("title"),
      kind: form.get("kind"),
      text: form.get("text") || undefined,
      method: form.get("method") || undefined,
      apiKey: form.get("apiKey") || undefined,
    });
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid form" }, { status: 400 });
    }
    title = parsed.data.title;
    kind = parsed.data.kind;
    method = parsed.data.method;
    apiKey = parsed.data.apiKey;
    const file = form.get("file");
    if (file instanceof File && file.size > 0) {
      if (file.size > 15 * 1024 * 1024) {
        return NextResponse.json({ error: "File too large (15 MB max)" }, { status: 400 });
      }
      const buf = await file.arrayBuffer();
      const name = file.name.toLowerCase();
      try {
        if (name.endsWith(".pdf") || file.type === "application/pdf") {
          text = await extractPdfText(buf);
        } else {
          text = new TextDecoder().decode(buf);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return NextResponse.json(
          { error: `Could not read the file: ${message}` },
          { status: 422 },
        );
      }
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
    method = parsed.data.method;
    apiKey = parsed.data.apiKey;
    text = parsed.data.text;
  }

  text = text.replace(/\s+/g, " ").trim();
  if (text.length < 40) {
    return NextResponse.json(
      { error: "Not enough text to analyze (need ~40+ characters)" },
      { status: 400 },
    );
  }

  try {
    const classifications =
      method === "llm"
        ? await classifyDocument(text, kind, title, apiKey)
        : await classifyByKeywords(text);
    const resolved = await resolveClassifications(classifications);
    return NextResponse.json({
      title,
      kind,
      status: "done",
      classified: resolved.directCount,
      nodes: resolved.nodes,
      coverage: resolved.coverage,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ status: "error", error: message }, { status: 500 });
  }
}
