"use client";

import { useCallback, useEffect, useState } from "react";
import {
  deleteDocument,
  loadDocuments,
  newDocumentId,
  saveDocument,
  type LocalDocument,
} from "@/lib/localStore";

interface Props {
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
  activeDocumentId,
  onShowHeatmap,
  onClose,
  onNavigate,
}: Props) {
  const [docs, setDocs] = useState<LocalDocument[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<(typeof KINDS)[number]["value"]>("exam");
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<"list" | "upload">("list");
  const [method, setMethod] = useState<"keyword" | "llm">("keyword");
  const [apiKey, setApiKey] = useState("");
  const [llmConfigured, setLlmConfigured] = useState(false);

  const refresh = useCallback(() => {
    setDocs(loadDocuments());
  }, []);

  useEffect(() => {
    refresh();
    fetch("/api/analyze")
      .then((r) => r.json())
      .then((d) => setLlmConfigured(!!d.llmConfigured))
      .catch(() => setLlmConfigured(false));
  }, [refresh]);

  const active = docs.find((d) => d.id === activeDocumentId) ?? null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setUploading(true);
    try {
      const form = new FormData();
      const docTitle = title.trim() || file?.name || "Untitled document";
      form.set("title", docTitle);
      form.set("kind", kind);
      form.set("method", method);
      if (method === "llm" && apiKey.trim()) form.set("apiKey", apiKey.trim());
      if (file) form.set("file", file);
      if (text.trim()) form.set("text", text.trim());
      const res = await fetch("/api/analyze", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Analyze failed (${res.status})`);

      const doc: LocalDocument = {
        id: newDocumentId(),
        title: data.title ?? docTitle,
        kind: data.kind ?? kind,
        createdAt: new Date().toISOString(),
        nodes: data.nodes ?? [],
        coverage: data.coverage ?? [],
      };
      setDocs(saveDocument(doc));
      setTitle("");
      setText("");
      setFile(null);
      setMode("list");
      onShowHeatmap(doc.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  };

  const remove = (id: string) => {
    setDocs(deleteDocument(id));
    if (activeDocumentId === id) onShowHeatmap(null);
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
              Upload a PDF or paste text from a paper, syllabus, or exam. Coverage is
              saved in this browser&apos;s local storage.
            </p>
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
            {docs.length === 0 && (
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
                const isActive = d.id === activeDocumentId;
                return (
                  <div
                    key={d.id}
                    className={`rounded-xl border p-3 ${
                      isActive
                        ? "border-orange-400/40 bg-orange-500/10"
                        : "border-slate-700/40 bg-slate-800/30"
                    }`}
                  >
                    <div className="mb-1 flex items-start justify-between gap-2">
                      <button
                        onClick={() => onShowHeatmap(isActive ? null : d.id)}
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
                      <span className="text-emerald-400">local</span>
                      <span>·</span>
                      <span>{new Date(d.createdAt).toLocaleDateString()}</span>
                    </div>
                    {isActive && (
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

            {active && (
              <div className="mt-4">
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">
                  Coverage ({active.coverage.length})
                </p>
                <div className="flex flex-col gap-1.5">
                  {active.coverage.slice(0, 25).map((c) => (
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
