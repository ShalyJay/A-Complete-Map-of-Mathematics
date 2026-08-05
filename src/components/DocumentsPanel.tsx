"use client";

import { useCallback, useEffect, useState } from "react";
import type { DocumentLite } from "@/lib/types";

interface CoverageRow {
  nodeId: string;
  weight: number;
  rationale: string | null;
  title: string;
  type: string;
  mscCode: string | null;
}

interface Props {
  signedIn: boolean;
  activeDocumentId: string | null;
  onShowHeatmap: (documentId: string | null) => void;
  onClose: () => void;
  onNavigate: (id: string) => void;
}

const KINDS = [
  { value: "paper", label: "Paper" },
  { value: "course", label: "Course / syllabus" },
  { value: "exam", label: "Exam" },
  { value: "other", label: "Other" },
] as const;

export default function DocumentsPanel({
  signedIn,
  activeDocumentId,
  onShowHeatmap,
  onClose,
  onNavigate,
}: Props) {
  const [docs, setDocs] = useState<DocumentLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<(typeof KINDS)[number]["value"]>("exam");
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [coverage, setCoverage] = useState<CoverageRow[] | null>(null);
  const [mode, setMode] = useState<"list" | "upload">("list");
  const [method, setMethod] = useState<"keyword" | "llm">("keyword");
  const [apiKey, setApiKey] = useState("");
  const [llmConfigured, setLlmConfigured] = useState(false);

  const refresh = useCallback(() => {
    setLoading(true);
    fetch("/api/documents")
      .then((r) => r.json())
      .then((d) => {
        setDocs(d.documents ?? []);
        setLlmConfigured(!!d.llmConfigured);
      })
      .catch(() => setDocs([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh, signedIn]);

  useEffect(() => {
    if (!activeDocumentId) {
      setCoverage(null);
      return;
    }
    fetch(`/api/documents/${activeDocumentId}`)
      .then((r) => r.json())
      .then((d) => setCoverage(d.coverage ?? []))
      .catch(() => setCoverage([]));
  }, [activeDocumentId]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setUploading(true);
    try {
      const form = new FormData();
      form.set("title", title.trim() || file?.name || "Untitled document");
      form.set("kind", kind);
      form.set("method", method);
      if (method === "llm" && apiKey.trim()) form.set("apiKey", apiKey.trim());
      if (file) form.set("file", file);
      if (text.trim()) form.set("text", text.trim());
      const res = await fetch("/api/documents", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Upload failed (${res.status})`);
      setTitle("");
      setText("");
      setFile(null);
      setMode("list");
      refresh();
      onShowHeatmap(data.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  };

  const remove = async (id: string) => {
    await fetch(`/api/documents/${id}`, { method: "DELETE" });
    if (activeDocumentId === id) onShowHeatmap(null);
    refresh();
  };

  return (
    <aside className="panel pointer-events-auto flex h-full w-96 flex-col rounded-2xl shadow-2xl">
      <div className="flex items-center justify-between border-b border-slate-700/40 p-4">
        <h2 className="text-lg font-semibold">Documents</h2>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setMode((m) => (m === "list" ? "upload" : "list"))}
            className="rounded-lg px-2.5 py-1 text-sm text-slate-300 hover:bg-slate-700/40 hover:text-white"
          >
            {mode === "list" ? "Upload" : "Back"}
          </button>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-700/40 hover:text-white"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
      </div>

      <div className="panel-scroll flex-1 overflow-y-auto p-4">
        {mode === "upload" ? (
          <form onSubmit={submit} className="flex flex-col gap-3">
            <p className="text-sm text-slate-400">
              Upload a PDF or paste text from a paper, syllabus, or exam. Its topics
              get mapped onto the MSC taxonomy and painted as a coverage heatmap.
            </p>
            {!signedIn && (
              <p className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-200/90">
                Not signed in — analyses stay on this machine. Sign in to keep them
                across devices.
              </p>
            )}
            <label className="block text-xs font-medium uppercase tracking-wide text-slate-400">
              Title
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Putnam 2023"
                className="mt-1 w-full rounded-lg border border-slate-700/60 bg-slate-800/60 px-3 py-2 text-sm outline-none"
              />
            </label>
            <label className="block text-xs font-medium uppercase tracking-wide text-slate-400">
              Kind
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value as typeof kind)}
                className="mt-1 w-full rounded-lg border border-slate-700/60 bg-slate-800/60 px-3 py-2 text-sm outline-none"
              >
                {KINDS.map((k) => (
                  <option key={k.value} value={k.value}>
                    {k.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs font-medium uppercase tracking-wide text-slate-400">
              PDF or text file
              <input
                type="file"
                accept=".pdf,.txt,.md,text/plain,application/pdf"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="mt-1 block w-full text-sm text-slate-300 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-700/60 file:px-3 file:py-1.5 file:text-sm file:text-slate-200"
              />
            </label>
            <label className="block text-xs font-medium uppercase tracking-wide text-slate-400">
              Or paste text
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={8}
                placeholder="Paste syllabus, problem list, abstract…"
                className="mt-1 w-full resize-y rounded-lg border border-slate-700/60 bg-slate-800/60 px-3 py-2 text-sm outline-none"
              />
            </label>
            <div>
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">
                Analysis method
              </p>
              <div className="flex rounded-lg border border-slate-700/60 bg-slate-800/60 p-1 text-sm">
                <button
                  type="button"
                  onClick={() => setMethod("keyword")}
                  className={`flex-1 rounded-md px-3 py-1.5 ${method === "keyword" ? "bg-slate-600/60 text-white" : "text-slate-400 hover:text-white"}`}
                >
                  Local NLP
                </button>
                <button
                  type="button"
                  onClick={() => setMethod("llm")}
                  className={`flex-1 rounded-md px-3 py-1.5 ${method === "llm" ? "bg-slate-600/60 text-white" : "text-slate-400 hover:text-white"}`}
                >
                  AI (Claude)
                </button>
              </div>
              <p className="mt-1.5 text-xs leading-snug text-slate-500">
                {method === "keyword"
                  ? "Offline: noun-phrase parsing + tiny local embeddings against the map. First run downloads a ~23 MB model."
                  : "Deeper semantic analysis via the Anthropic API."}
              </p>
              {method === "llm" && !llmConfigured && (
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="Anthropic API key (sk-ant-…)"
                  className="mt-2 w-full rounded-lg border border-slate-700/60 bg-slate-800/60 px-3 py-2 text-sm outline-none placeholder:text-slate-500"
                />
              )}
              {method === "llm" && llmConfigured && (
                <p className="mt-1.5 text-xs text-emerald-400/80">
                  Server API key configured — no key needed.
                </p>
              )}
              {method === "llm" && !llmConfigured && (
                <p className="mt-1.5 text-xs leading-snug text-slate-500">
                  Used only for this request — never stored.
                </p>
              )}
            </div>
            {error && (
              <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
                {error}
              </p>
            )}
            <button
              type="submit"
              disabled={
                uploading ||
                (!file && !text.trim()) ||
                (method === "llm" && !llmConfigured && !apiKey.trim())
              }
              className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
            >
              {uploading
                ? method === "llm"
                  ? "Analyzing… this can take ~30s"
                  : "Analyzing…"
                : "Analyze & show heatmap"}
            </button>
          </form>
        ) : (
          <>
            {loading && <p className="text-sm text-slate-400">Loading…</p>}
            {!loading && docs.length === 0 && (
              <div className="text-sm text-slate-400">
                <p className="mb-3">No documents yet.</p>
                <button
                  onClick={() => setMode("upload")}
                  className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
                >
                  Upload your first
                </button>
              </div>
            )}
            <div className="flex flex-col gap-2">
              {docs.map((d) => {
                const active = d.id === activeDocumentId;
                return (
                  <div
                    key={d.id}
                    className={`rounded-xl border p-3 ${
                      active
                        ? "border-orange-400/40 bg-orange-500/10"
                        : "border-slate-700/40 bg-slate-800/30"
                    }`}
                  >
                    <div className="mb-1 flex items-start justify-between gap-2">
                      <button
                        onClick={() => onShowHeatmap(active ? null : d.id)}
                        className="text-left text-sm font-medium text-slate-100 hover:text-white"
                      >
                        {d.title}
                      </button>
                      <button
                        onClick={() => remove(d.id)}
                        className="text-xs text-slate-500 hover:text-rose-400"
                        title="Delete"
                      >
                        Delete
                      </button>
                    </div>
                    <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-slate-500">
                      <span>{d.kind}</span>
                      <span>·</span>
                      <span
                        className={
                          d.status === "done"
                            ? "text-emerald-400"
                            : d.status === "error"
                              ? "text-rose-400"
                              : "text-amber-400"
                        }
                      >
                        {d.status}
                      </span>
                      <span>·</span>
                      <span>{new Date(d.createdAt).toLocaleDateString()}</span>
                    </div>
                    {active && (
                      <button
                        onClick={() => onShowHeatmap(null)}
                        className="mt-2 text-xs text-orange-300 hover:text-orange-200"
                      >
                        Clear heatmap
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            {activeDocumentId && coverage && (
              <div className="mt-4">
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">
                  Coverage ({coverage.length})
                </p>
                <div className="flex flex-col gap-1.5">
                  {coverage.slice(0, 25).map((c) => (
                    <button
                      key={c.nodeId}
                      onClick={() => onNavigate(c.nodeId)}
                      className="rounded-lg px-2.5 py-2 text-left hover:bg-slate-700/40"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm text-slate-200">{c.title}</span>
                        <span className="shrink-0 text-[11px] text-orange-300">
                          {(c.weight * 100).toFixed(0)}%
                        </span>
                      </div>
                      {c.rationale && (
                        <p className="mt-0.5 text-xs leading-snug text-slate-500">
                          {c.rationale}
                        </p>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </aside>
  );
}
