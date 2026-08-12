"use client";

import { useEffect, useState } from "react";
import type { NodeDetail, UserNodeStateLite } from "@/lib/types";

const TYPE_STYLES: Record<string, string> = {
  branch: "bg-violet-500/20 text-violet-300",
  field: "bg-blue-500/20 text-blue-300",
  subfield: "bg-cyan-500/20 text-cyan-300",
  topic: "bg-teal-500/20 text-teal-300",
  theorem: "bg-amber-500/20 text-amber-300",
  axiom: "bg-rose-500/20 text-rose-300",
  conjecture: "bg-fuchsia-500/20 text-fuchsia-300",
  definition: "bg-lime-500/20 text-lime-300",
};

const RELATION_LABELS: Record<string, string> = {
  "builds-on": "Builds on",
  "leads-to": "Leads to",
  parent: "Part of",
  child: "Contains",
  "see-also": "See also",
  related: "Related",
};

interface ArxivPaperLite {
  id: string;
  title: string;
  summary: string;
  authors: string[];
  published: string;
  absUrl: string;
  pdfUrl: string;
  primaryCategory: string | null;
}

interface ArxivPayload {
  papers: ArxivPaperLite[];
  total: number;
  searchUrl: string | null;
  skipped?: boolean;
  reason?: string;
  error?: string;
}

interface Props {
  nodeId: string;
  onClose: () => void;
  onNavigate: (id: string) => void;
  userState: UserNodeStateLite | null | undefined;
  onStateChange: (patch: { mastery?: number; isProblemArea?: boolean }) => void;
}

function yearOf(iso: string): string {
  if (!iso) return "";
  const y = iso.slice(0, 4);
  return /^\d{4}$/.test(y) ? y : "";
}

function authorLine(authors: string[]): string {
  if (authors.length === 0) return "";
  if (authors.length <= 2) return authors.join(", ");
  return `${authors[0]} et al.`;
}

export default function DetailPanel({
  nodeId,
  onClose,
  onNavigate,
  userState,
  onStateChange,
}: Props) {
  const [detail, setDetail] = useState<NodeDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [papers, setPapers] = useState<ArxivPayload | null>(null);
  const [papersLoading, setPapersLoading] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setPapers(null);
    fetch(`/api/node/${encodeURIComponent(nodeId)}`)
      .then((r) => r.json())
      .then((d) => {
        if (alive) {
          setDetail(d);
          setLoading(false);
        }
      })
      .catch(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [nodeId]);

  useEffect(() => {
    if (!detail?.id || detail.type === "branch") {
      setPapers(null);
      return;
    }
    let alive = true;
    setPapersLoading(true);
    fetch(`/api/arxiv?nodeId=${encodeURIComponent(detail.id)}&max=8`)
      .then(async (r) => {
        const body = (await r.json()) as ArxivPayload;
        if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`);
        return body;
      })
      .then((d) => {
        if (alive) {
          setPapers(d);
          setPapersLoading(false);
        }
      })
      .catch(() => {
        if (alive) {
          setPapers({ papers: [], total: 0, searchUrl: null, error: "unavailable" });
          setPapersLoading(false);
        }
      });
    return () => {
      alive = false;
    };
  }, [detail?.id, detail?.type]);

  const grouped = new Map<string, NodeDetail["connections"]>();
  for (const c of detail?.connections ?? []) {
    const arr = grouped.get(c.relation) ?? [];
    arr.push(c);
    grouped.set(c.relation, arr);
  }

  const mastery = userState?.mastery ?? 0;
  const isProblem = userState?.isProblemArea ?? false;

  return (
    <aside className="panel pointer-events-auto flex h-full w-96 flex-col rounded-2xl shadow-2xl">
      <div className="flex items-start justify-between gap-2 border-b border-slate-700/40 p-4">
        <div>
          {detail && (
            <span
              className={`mb-1.5 inline-block rounded-md px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide ${TYPE_STYLES[detail.type] ?? "bg-slate-600/30 text-slate-300"}`}
            >
              {detail.type}
              {detail.mscCode ? ` · MSC ${detail.mscCode}` : ""}
            </span>
          )}
          <h2 className="text-lg font-semibold leading-snug">
            {detail?.title ?? "…"}
          </h2>
        </div>
        <button
          onClick={onClose}
          className="rounded-lg p-1 text-slate-400 hover:bg-slate-700/40 hover:text-white"
          aria-label="Close"
        >
          ✕
        </button>
      </div>

      <div className="panel-scroll flex-1 overflow-y-auto p-4">
        {loading && <p className="text-sm text-slate-400">Loading…</p>}

        {detail?.thumbnailUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={detail.thumbnailUrl}
            alt={detail.title}
            className="mb-3 max-h-44 rounded-xl border border-slate-700/40 object-contain"
          />
        )}

        {detail?.summary && (
          <p className="mb-4 text-sm leading-relaxed text-slate-300">{detail.summary}</p>
        )}
        {detail && !detail.summary && !loading && (
          <p className="mb-4 text-sm italic text-slate-500">
            No description available for this node yet.
          </p>
        )}

        <div className="mb-4 flex flex-wrap gap-2 text-xs">
          {detail?.wikipediaUrl && (
            <a
              href={detail.wikipediaUrl}
              target="_blank"
              rel="noreferrer"
              className="rounded-lg bg-slate-700/50 px-2.5 py-1.5 text-slate-200 hover:bg-slate-600/50"
            >
              Wikipedia ↗
            </a>
          )}
          {detail?.wikidataQid && (
            <a
              href={`https://www.wikidata.org/wiki/${detail.wikidataQid}`}
              target="_blank"
              rel="noreferrer"
              className="rounded-lg bg-slate-700/50 px-2.5 py-1.5 text-slate-200 hover:bg-slate-600/50"
            >
              Wikidata ↗
            </a>
          )}
          {detail?.mscCode && (
            <a
              href={`https://zbmath.org/classification/?q=cc%3A${encodeURIComponent(detail.mscCode)}`}
              target="_blank"
              rel="noreferrer"
              className="rounded-lg bg-slate-700/50 px-2.5 py-1.5 text-slate-200 hover:bg-slate-600/50"
            >
              zbMATH ↗
            </a>
          )}
          {papers?.searchUrl && (
            <a
              href={papers.searchUrl}
              target="_blank"
              rel="noreferrer"
              className="rounded-lg bg-orange-500/15 px-2.5 py-1.5 text-orange-200 hover:bg-orange-500/25"
            >
              arXiv search ↗
            </a>
          )}
        </div>

        {/* Live arXiv papers related to this node */}
        {detail && detail.type !== "branch" && (
          <div className="mb-4">
            <div className="mb-1.5 flex items-baseline justify-between gap-2">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                Papers on arXiv
                {papers && !papers.skipped && papers.total > 0
                  ? ` · ${papers.total.toLocaleString()} hits`
                  : ""}
              </p>
            </div>
            <p className="mb-2 text-[11px] leading-snug text-slate-600">
              Live keyword search — not curated peer review.
            </p>
            {papersLoading && (
              <p className="text-sm text-slate-500">Searching arXiv…</p>
            )}
            {!papersLoading && papers?.skipped && (
              <p className="text-sm italic text-slate-500">
                {papers.reason ?? "No arXiv query for this node."}
              </p>
            )}
            {!papersLoading && papers?.error && (
              <p className="text-sm italic text-slate-500">
                arXiv is temporarily unavailable.
              </p>
            )}
            {!papersLoading &&
              papers &&
              !papers.skipped &&
              !papers.error &&
              papers.papers.length === 0 && (
                <p className="text-sm italic text-slate-500">
                  No matching preprints found.
                </p>
              )}
            {!papersLoading && papers && papers.papers.length > 0 && (
              <ul className="flex flex-col gap-2">
                {papers.papers.map((p) => (
                  <li
                    key={p.id}
                    className="rounded-lg border border-slate-700/40 bg-slate-800/30 px-2.5 py-2"
                  >
                    <a
                      href={p.absUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="block text-sm leading-snug text-slate-200 hover:text-orange-200"
                    >
                      {p.title}
                    </a>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {authorLine(p.authors)}
                      {yearOf(p.published)
                        ? ` · ${yearOf(p.published)}`
                        : ""}
                      {p.primaryCategory ? ` · ${p.primaryCategory}` : ""}
                    </p>
                    {p.summary && (
                      <p className="mt-1 line-clamp-2 text-xs leading-snug text-slate-500">
                        {p.summary}
                      </p>
                    )}
                    <div className="mt-1.5 flex gap-2 text-[11px]">
                      <a
                        href={p.absUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-orange-300/90 hover:text-orange-200"
                      >
                        Abstract
                      </a>
                      <a
                        href={p.pdfUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-orange-300/90 hover:text-orange-200"
                      >
                        PDF
                      </a>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* mastery controls — persisted in localStorage */}
        <div className="mb-4 rounded-xl border border-slate-700/40 bg-slate-800/40 p-3">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">
            Your mastery
          </p>
          <div className="flex items-center gap-1">
            {[1, 2, 3, 4, 5].map((v) => (
              <button
                key={v}
                onClick={() => onStateChange({ mastery: mastery === v ? 0 : v })}
                className={`h-7 w-9 rounded-md text-sm transition-colors ${
                  v <= mastery
                    ? "bg-emerald-500/70 text-white"
                    : "bg-slate-700/50 text-slate-400 hover:bg-slate-600/50"
                }`}
                title={`Mastery ${v}/5`}
              >
                {v}
              </button>
            ))}
          </div>
          <label className="mt-2.5 flex cursor-pointer items-center gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={isProblem}
              onChange={(e) => onStateChange({ isProblemArea: e.target.checked })}
              className="h-4 w-4 accent-rose-500"
            />
            Mark as problem area
          </label>
        </div>

        {/* connections: what each link points to, and why they're connected */}
        {[...grouped.entries()].map(([relation, items]) => {
          const showWhy = relation !== "parent" && relation !== "child";
          return (
            <div key={relation} className="mb-3">
              <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-400">
                {RELATION_LABELS[relation] ?? relation} ({items.length})
              </p>
              <div className="flex flex-col gap-1">
                {items.slice(0, 15).map((c) => (
                  <button
                    key={c.id}
                    onClick={() => onNavigate(c.id)}
                    className="rounded-lg px-2.5 py-1.5 text-left hover:bg-slate-700/40"
                    title={c.title}
                  >
                    <span
                      className={`block truncate text-sm ${
                        relation === "builds-on" || relation === "leads-to"
                          ? "text-amber-200/90"
                          : "text-slate-300"
                      }`}
                    >
                      {c.title}
                    </span>
                    {showWhy && c.note && (
                      <span className="mt-0.5 block text-xs leading-snug text-slate-500">
                        {c.note}
                      </span>
                    )}
                  </button>
                ))}
                {items.length > 15 && (
                  <p className="px-2.5 text-xs text-slate-500">
                    +{items.length - 15} more
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
