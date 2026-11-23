"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type {
  DocumentNodeLite,
  GraphPayload,
  OverlayMode,
  UserNodeStateLite,
} from "@/lib/types";
import { getDocument, loadMastery, saveMasteryEntry } from "@/lib/localStore";
import { buildGraph, buildIndex, collapseSingleFieldBranches } from "./map/graphStore";
import { computeHeatColors, computeMasteryColors } from "./map/overlays";
import type { FocusRequest } from "./map/MathMap";
import SearchBox from "./SearchBox";
import Breadcrumbs from "./Breadcrumbs";
import DetailPanel from "./DetailPanel";
import DocumentsPanel from "./DocumentsPanel";
import { DOMAINS } from "@/lib/branches";

const MathMap = dynamic(() => import("./map/MathMap"), { ssr: false });
const MathMap3D = dynamic(() => import("./map/MathMap3D"), { ssr: false });

export default function AppShell() {
  const [payload, setPayload] = useState<GraphPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focus, setFocus] = useState<FocusRequest | null>(null);
  const [states, setStates] = useState<UserNodeStateLite[]>([]);
  const [overlay, setOverlay] = useState<OverlayMode>("none");
  const [docNodes, setDocNodes] = useState<DocumentNodeLite[] | null>(null);
  const [docsOpen, setDocsOpen] = useState(false);
  const [is3D, setIs3D] = useState(true);
  const nonce = useRef(0);

  useEffect(() => {
    fetch("/api/graph")
      .then(async (r) => {
        if (!r.ok) {
          let detail = "";
          try {
            const body = (await r.json()) as { error?: string };
            if (body.error) detail = `: ${body.error}`;
          } catch {
            /* ignore */
          }
          throw new Error(`API error ${r.status}${detail}`);
        }
        return r.json();
      })
      .then((p: GraphPayload) => setPayload(collapseSingleFieldBranches(p)))
      .catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    setStates(loadMastery());
  }, []);

  const index = useMemo(() => (payload ? buildIndex(payload) : null), [payload]);
  const graph = useMemo(
    () => (payload && index ? buildGraph(payload, index) : null),
    [payload, index],
  );

  // Document heatmap from localStorage
  useEffect(() => {
    if (typeof overlay === "object") {
      const doc = getDocument(overlay.documentId);
      setDocNodes(doc?.nodes ?? []);
    } else {
      setDocNodes(null);
    }
  }, [overlay]);

  const overlayColors = useMemo(() => {
    if (!index) return null;
    if (overlay === "mastery") return computeMasteryColors(index, states);
    if (typeof overlay === "object" && docNodes) return computeHeatColors(index, docNodes);
    return null;
  }, [overlay, index, states, docNodes]);

  const navigateTo = useCallback(
    (id: string) => {
      if (!index) return;
      setExpanded((prev) => {
        const next = new Set(prev);
        for (const a of index.ancestorsOf(id)) next.add(a);
        const node = index.byId.get(id);
        if (node && node.childCount > 0) next.add(id);
        return next;
      });
      setSelectedId(id);
      setFocus({ id, nonce: ++nonce.current });
    },
    [index],
  );

  const toggleExpand = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setFocus({ id, nonce: ++nonce.current });
  }, []);

  const goHome = useCallback(() => {
    setExpanded(new Set());
    setSelectedId(null);
    setFocus({ id: DOMAINS[0].id, nonce: ++nonce.current });
  }, []);

  const breadcrumbNavigate = useCallback(
    (id: string) => {
      if (!index) return;
      setExpanded((prev) => {
        const next = new Set<string>();
        for (const e of prev) {
          if (e !== id && index.ancestorsOf(e).includes(id)) continue;
          next.add(e);
        }
        for (const a of index.ancestorsOf(id)) next.add(a);
        next.add(id);
        return next;
      });
      setSelectedId(id);
      setFocus({ id, nonce: ++nonce.current });
    },
    [index],
  );

  const stateFor = useCallback(
    (nodeId: string) => states.find((s) => s.nodeId === nodeId),
    [states],
  );

  const patchState = useCallback(
    (nodeId: string, patch: { mastery?: number; isProblemArea?: boolean }) => {
      setStates(saveMasteryEntry(nodeId, patch));
    },
    [],
  );

  if (error) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="panel max-w-md rounded-2xl p-6 text-sm text-slate-300">
          <p className="mb-2 font-semibold text-white">Couldn&apos;t load the map</p>
          <p className="mb-3 text-slate-400">{error}</p>
          <p className="text-slate-400">
            The graph comes from the Personal Wiki vault. Locally: run{" "}
            <code className="rounded bg-slate-800 px-1.5 py-0.5">npm run sync:vault</code>{" "}
            then reload; a deployment needs a committed{" "}
            <code className="rounded bg-slate-800 px-1.5 py-0.5">data/vault/</code>.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-screen w-screen overflow-hidden">
      {graph && index && (is3D ? (
        <MathMap3D
          graph={graph}
          index={index}
          selectedId={selectedId}
          onSelect={setSelectedId}
          expanded={expanded}
          onToggleExpand={toggleExpand}
          focus={focus}
          overlayColors={overlayColors}
        />
      ) : (
        <MathMap
          graph={graph}
          index={index}
          selectedId={selectedId}
          onSelect={setSelectedId}
          expanded={expanded}
          onToggleExpand={toggleExpand}
          focus={focus}
          overlayColors={overlayColors}
        />
      ))}

      {!payload && !error && (
        <div className="absolute inset-0 flex items-center justify-center">
          <p className="animate-pulse text-slate-400">Loading the map…</p>
        </div>
      )}

      <div className="pointer-events-none absolute left-0 right-0 top-0 z-10 flex items-start justify-between gap-3 p-4">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-3">
            <h1 className="pointer-events-auto select-none text-lg font-bold tracking-tight text-white">
              A Complete Map of <span className="text-indigo-400">Math</span>,{" "}
              <span className="text-amber-400">Physics</span> &amp;{" "}
              <span className="text-emerald-400">CS</span>
            </h1>
            {payload && <SearchBox nodes={payload.nodes} onPick={navigateTo} />}
          </div>
          {index && (
            <Breadcrumbs
              selectedId={selectedId}
              index={index}
              onNavigate={breadcrumbNavigate}
              onHome={goHome}
            />
          )}
        </div>

        <div className="flex items-center gap-2">
          <div className="panel pointer-events-auto flex rounded-xl p-1 text-sm">
            <button
              onClick={() => setIs3D(true)}
              className={`rounded-lg px-3 py-1.5 ${is3D ? "bg-slate-600/60 text-white" : "text-slate-400 hover:text-white"}`}
              title="Navigable 3D space — drag to rotate, scroll to zoom"
            >
              3D
            </button>
            <button
              onClick={() => setIs3D(false)}
              className={`rounded-lg px-3 py-1.5 ${!is3D ? "bg-slate-600/60 text-white" : "text-slate-400 hover:text-white"}`}
              title="Flat radial map"
            >
              2D
            </button>
          </div>
          <div className="panel pointer-events-auto flex rounded-xl p-1 text-sm">
            <button
              onClick={() => setOverlay("none")}
              className={`rounded-lg px-3 py-1.5 ${overlay === "none" ? "bg-slate-600/60 text-white" : "text-slate-400 hover:text-white"}`}
            >
              Map
            </button>
            <button
              onClick={() => setOverlay("mastery")}
              className={`rounded-lg px-3 py-1.5 ${overlay === "mastery" ? "bg-slate-600/60 text-white" : "text-slate-400 hover:text-white"}`}
              title="Personal mastery overlay (saved in this browser)"
            >
              Mastery
            </button>
            <button
              onClick={() => setDocsOpen((o) => !o)}
              className={`rounded-lg px-3 py-1.5 ${typeof overlay === "object" || docsOpen ? "bg-slate-600/60 text-white" : "text-slate-400 hover:text-white"}`}
            >
              Documents
            </button>
          </div>
        </div>
      </div>

      <div className="panel pointer-events-auto absolute bottom-4 left-4 z-10 rounded-xl p-3">
        {overlay === "none" ? (
          <div>
            <div className="flex flex-col gap-1.5">
              {DOMAINS.map((b) => (
                <button
                  key={b.id}
                  onClick={() => navigateTo(b.id)}
                  className="flex items-center gap-1.5 text-left text-xs text-slate-300 hover:text-white"
                >
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ background: b.color }}
                  />
                  {b.title}
                </button>
              ))}
            </div>
            <div className="mt-2 flex items-center gap-3 border-t border-slate-700/40 pt-2 text-[11px] text-slate-400">
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-amber-200" />
                Axioms (inner arc)
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-0.5 w-4 rounded bg-orange-400" />
                builds on
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-0.5 w-4 rounded bg-emerald-400/60" />
                bridge
              </span>
            </div>
          </div>
        ) : overlay === "mastery" ? (
          <div className="flex items-center gap-3 text-xs text-slate-300">
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-[#333f52]" /> Unexplored
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-red-500" /> Struggling
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-amber-500" /> Learning
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-green-500" /> Mastered
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-3 text-xs text-slate-300">
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-[#333f52]" /> Not covered
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-orange-400" /> Covered
            </span>
          </div>
        )}
      </div>

      <div className="pointer-events-none absolute bottom-4 left-1/2 z-10 -translate-x-1/2 text-xs text-slate-500">
        {is3D
          ? "Drag to rotate · shift-drag or ⌘-drag to pan · scroll to zoom · click bubbles to expand"
          : "Click to explore · click a concept to pin its prerequisite chain · scroll to zoom"}
      </div>

      <div className="absolute bottom-4 right-4 top-20 z-10 flex gap-3">
        {docsOpen && (
          <DocumentsPanel
            activeDocumentId={typeof overlay === "object" ? overlay.documentId : null}
            onShowHeatmap={(documentId) =>
              setOverlay(documentId ? { documentId } : "none")
            }
            onClose={() => setDocsOpen(false)}
            onNavigate={navigateTo}
          />
        )}
        {selectedId && (
          <DetailPanel
            nodeId={selectedId}
            onClose={() => setSelectedId(null)}
            onNavigate={navigateTo}
            userState={stateFor(selectedId)}
            onStateChange={(patch) => patchState(selectedId, patch)}
          />
        )}
      </div>
    </div>
  );
}
