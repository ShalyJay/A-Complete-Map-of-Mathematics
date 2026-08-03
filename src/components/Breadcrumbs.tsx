"use client";

import type { NodeIndex } from "./map/graphStore";

interface Props {
  selectedId: string | null;
  index: NodeIndex;
  onNavigate: (id: string) => void;
  onHome: () => void;
}

export default function Breadcrumbs({ selectedId, index, onNavigate, onHome }: Props) {
  const chain = selectedId
    ? [...index.ancestorsOf(selectedId), selectedId]
    : [];

  return (
    <nav className="pointer-events-auto flex max-w-[60vw] items-center gap-1 overflow-x-auto text-sm">
      <button
        onClick={onHome}
        className="panel shrink-0 rounded-lg px-3 py-1.5 text-slate-300 hover:text-white"
      >
        ⌂ Mathematics
      </button>
      {chain.map((id) => {
        const node = index.byId.get(id);
        if (!node) return null;
        return (
          <span key={id} className="flex shrink-0 items-center gap-1">
            <span className="text-slate-600">›</span>
            <button
              onClick={() => onNavigate(id)}
              className={`panel rounded-lg px-3 py-1.5 hover:text-white ${
                id === selectedId ? "text-white" : "text-slate-300"
              }`}
            >
              {node.title.length > 40 ? node.title.slice(0, 38) + "…" : node.title}
            </button>
          </span>
        );
      })}
    </nav>
  );
}
