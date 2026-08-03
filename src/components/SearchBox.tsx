"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Fuse from "fuse.js";
import type { GraphNodeLite } from "@/lib/types";

const TYPE_BADGES: Record<string, string> = {
  branch: "Branch",
  field: "Field",
  subfield: "Subfield",
  topic: "Topic",
  theorem: "Theorem",
  lemma: "Lemma",
  inequality: "Inequality",
  axiom: "Axiom",
  conjecture: "Conjecture",
  definition: "Definition",
};

/** finer-grained tag than the raw node type: lemmas etc. read off the title */
function kindOf(n: GraphNodeLite): string {
  if (n.type !== "theorem") return n.type;
  const t = n.title.toLowerCase();
  if (t.includes("lemma")) return "lemma";
  if (t.includes("inequality")) return "inequality";
  return "theorem";
}

const KIND_TAGS = [
  { id: "axiom", label: "Axioms" },
  { id: "theorem", label: "Theorems" },
  { id: "lemma", label: "Lemmas" },
  { id: "inequality", label: "Inequalities" },
  { id: "conjecture", label: "Conjectures" },
  { id: "topic", label: "Topics" },
  { id: "subfield", label: "Subfields" },
];

interface Props {
  nodes: GraphNodeLite[];
  onPick: (id: string) => void;
}

export default function SearchBox({ nodes, onPick }: Props) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [kindFilter, setKindFilter] = useState<string | null>(null);
  const [branchFilter, setBranchFilter] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  /** each node's root branch, for the branch tag filter */
  const { branchOf, branches } = useMemo(() => {
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const branchOf = new Map<string, string>();
    const resolve = (n: GraphNodeLite): string => {
      const cached = branchOf.get(n.id);
      if (cached) return cached;
      const root = n.parentId && byId.has(n.parentId) ? resolve(byId.get(n.parentId)!) : n.id;
      branchOf.set(n.id, root);
      return root;
    };
    for (const n of nodes) resolve(n);
    const branches = nodes
      .filter((n) => n.depth === 0)
      .map((n) => ({ id: n.id, title: n.title }))
      .sort((a, b) => a.title.localeCompare(b.title));
    return { branchOf, branches };
  }, [nodes]);

  const fuse = useMemo(
    () =>
      new Fuse(nodes, {
        keys: [{ name: "title", weight: 1 }],
        threshold: 0.35,
        ignoreLocation: true,
      }),
    [nodes],
  );

  const matchesFilters = useMemo(() => {
    return (n: GraphNodeLite) =>
      (!kindFilter || kindOf(n) === kindFilter) &&
      (!branchFilter || branchOf.get(n.id) === branchFilter);
  }, [kindFilter, branchFilter, branchOf]);

  const results = useMemo(() => {
    const hasFilter = kindFilter !== null || branchFilter !== null;
    if (query.trim().length >= 2) {
      // search wide, then narrow by tags
      return fuse
        .search(query, { limit: hasFilter ? 200 : 12 })
        .filter((r) => matchesFilters(r.item))
        .slice(0, 12)
        .map((r) => r.item);
    }
    if (hasFilter) {
      // tag-only browsing: alphabetical listing of everything with that tag
      return nodes
        .filter(matchesFilters)
        .sort((a, b) => a.title.localeCompare(b.title))
        .slice(0, 50);
    }
    return [];
  }, [query, fuse, nodes, kindFilter, branchFilter, matchesFilters]);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const pick = (id: string) => {
    onPick(id);
    setOpen(false);
    setQuery("");
  };

  const chip = (selected: boolean) =>
    `shrink-0 rounded-full border px-2 py-0.5 text-[11px] transition-colors ${
      selected
        ? "border-amber-400/60 bg-amber-400/15 text-amber-200"
        : "border-slate-600/50 bg-slate-800/40 text-slate-400 hover:text-slate-200"
    }`;

  return (
    <div ref={boxRef} className="relative w-80 pointer-events-auto">
      <input
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            setActive((a) => Math.min(a + 1, results.length - 1));
            e.preventDefault();
          } else if (e.key === "ArrowUp") {
            setActive((a) => Math.max(a - 1, 0));
            e.preventDefault();
          } else if (e.key === "Enter" && results[active]) {
            pick(results[active].id);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        placeholder="Search theorems, fields, topics…"
        className="panel w-full rounded-xl px-4 py-2.5 text-sm outline-none placeholder:text-slate-500 focus:border-slate-500/40"
      />
      {open && (
        <div className="panel absolute top-full mt-2 w-full rounded-xl shadow-2xl">
          <div className="flex flex-wrap gap-1.5 border-b border-slate-700/40 px-3 py-2">
            {KIND_TAGS.map((t) => (
              <button
                key={t.id}
                className={chip(kindFilter === t.id)}
                onClick={() => {
                  setKindFilter((k) => (k === t.id ? null : t.id));
                  setActive(0);
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5 border-b border-slate-700/40 px-3 py-2">
            {branches.map((b) => (
              <button
                key={b.id}
                className={chip(branchFilter === b.id)}
                onClick={() => {
                  setBranchFilter((f) => (f === b.id ? null : b.id));
                  setActive(0);
                }}
              >
                {b.title}
              </button>
            ))}
          </div>
          {results.length > 0 ? (
            <div className="panel-scroll max-h-80 overflow-y-auto py-1">
              {results.map((n, i) => (
                <button
                  key={n.id}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => pick(n.id)}
                  className={`flex w-full items-center justify-between gap-2 px-4 py-2 text-left text-sm ${
                    i === active ? "bg-slate-700/40" : ""
                  }`}
                >
                  <span className="truncate">{n.title}</span>
                  <span className="shrink-0 rounded-md bg-slate-700/60 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-300">
                    {TYPE_BADGES[kindOf(n)] ?? n.type}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="px-4 py-3 text-xs text-slate-500">
              {query.trim().length >= 2 || kindFilter || branchFilter
                ? "No matches — adjust the tags or the query."
                : "Type to search, or pick a tag to browse."}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
