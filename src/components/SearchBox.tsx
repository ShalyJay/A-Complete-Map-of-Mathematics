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
  axiom: "Axiom",
  conjecture: "Conjecture",
  definition: "Definition",
};

interface Props {
  nodes: GraphNodeLite[];
  onPick: (id: string) => void;
}

export default function SearchBox({ nodes, onPick }: Props) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

  const fuse = useMemo(
    () =>
      new Fuse(nodes, {
        keys: [{ name: "title", weight: 1 }],
        threshold: 0.35,
        ignoreLocation: true,
      }),
    [nodes],
  );

  const results = useMemo(
    () => (query.trim().length < 2 ? [] : fuse.search(query, { limit: 12 })),
    [query, fuse],
  );

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
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            setActive((a) => Math.min(a + 1, results.length - 1));
            e.preventDefault();
          } else if (e.key === "ArrowUp") {
            setActive((a) => Math.max(a - 1, 0));
            e.preventDefault();
          } else if (e.key === "Enter" && results[active]) {
            pick(results[active].item.id);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        placeholder="Search theorems, fields, topics…"
        className="panel w-full rounded-xl px-4 py-2.5 text-sm outline-none placeholder:text-slate-500 focus:border-slate-500/40"
      />
      {open && results.length > 0 && (
        <div className="panel panel-scroll absolute top-full mt-2 max-h-96 w-full overflow-y-auto rounded-xl py-1 shadow-2xl">
          {results.map((r, i) => (
            <button
              key={r.item.id}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(r.item.id)}
              className={`flex w-full items-center justify-between gap-2 px-4 py-2 text-left text-sm ${
                i === active ? "bg-slate-700/40" : ""
              }`}
            >
              <span className="truncate">{r.item.title}</span>
              <span className="shrink-0 rounded-md bg-slate-700/60 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-300">
                {TYPE_BADGES[r.item.type] ?? r.item.type}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
