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
  parent: "Part of",
  child: "Contains",
  "see-also": "See also",
  related: "Related",
};

interface Props {
  nodeId: string;
  onClose: () => void;
  onNavigate: (id: string) => void;
  /** null = signed out */
  userState: UserNodeStateLite | null | undefined;
  signedIn: boolean;
  onStateChange: (patch: { mastery?: number; isProblemArea?: boolean }) => void;
}

export default function DetailPanel({
  nodeId,
  onClose,
  onNavigate,
  userState,
  signedIn,
  onStateChange,
}: Props) {
  const [detail, setDetail] = useState<NodeDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
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
        </div>

        {/* mastery controls */}
        <div className="mb-4 rounded-xl border border-slate-700/40 bg-slate-800/40 p-3">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">
            Your mastery
          </p>
          {signedIn ? (
            <>
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
            </>
          ) : (
            <p className="text-sm text-slate-500">
              Sign in to track mastery and problem areas.
            </p>
          )}
        </div>

        {/* connections */}
        {[...grouped.entries()].map(([relation, items]) => (
          <div key={relation} className="mb-3">
            <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-400">
              {RELATION_LABELS[relation] ?? relation} ({items.length})
            </p>
            <div className="flex flex-col gap-1">
              {items.slice(0, 15).map((c) => (
                <button
                  key={c.id}
                  onClick={() => onNavigate(c.id)}
                  className="truncate rounded-lg px-2.5 py-1.5 text-left text-sm text-slate-300 hover:bg-slate-700/40 hover:text-white"
                  title={c.title}
                >
                  {c.title}
                </button>
              ))}
              {items.length > 15 && (
                <p className="px-2.5 text-xs text-slate-500">
                  +{items.length - 15} more
                </p>
              )}
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}
