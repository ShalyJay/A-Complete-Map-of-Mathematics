"use client";

import { useEffect, useRef } from "react";
import Sigma from "sigma";
import type Graph from "graphology";
import type { NodeIndex } from "./graphStore";
import { baseColor } from "./graphStore";
import { layoutBranches, layoutChildren } from "./layout";

export interface FocusRequest {
  id: string;
  nonce: number;
}

interface Props {
  graph: Graph;
  index: NodeIndex;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** node ids the caller wants expanded (search jump / breadcrumb) */
  expanded: Set<string>;
  onToggleExpand: (id: string) => void;
  focus: FocusRequest | null;
  /** overlay color per node id; null = normal branch coloring */
  overlayColors: Map<string, string> | null;
}

const ZOOM_SPAN: Record<number, number> = { 0: 2400, 1: 1400, 2: 420, 3: 130, 4: 45 };

export default function MathMap({
  graph,
  index,
  selectedId,
  onSelect,
  expanded,
  onToggleExpand,
  focus,
  overlayColors,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<Sigma | null>(null);
  const laidOutRef = useRef<Set<string>>(new Set());
  const onSelectRef = useRef(onSelect);
  const onToggleRef = useRef(onToggleExpand);
  onSelectRef.current = onSelect;
  onToggleRef.current = onToggleExpand;

  // ---- init sigma ------------------------------------------------------------
  useEffect(() => {
    if (!containerRef.current) return;
    const branches = [...index.byId.values()]
      .filter((n) => n.depth === 0)
      .map((n) => n.id);
    layoutBranches(graph, branches);
    laidOutRef.current = new Set(["__branches__"]);

    const sigma = new Sigma(graph, containerRef.current, {
      allowInvalidContainer: true,
      renderLabels: true,
      labelColor: { color: "#cbd5e1" },
      labelSize: 12,
      labelWeight: "500",
      labelFont: "Inter, ui-sans-serif, system-ui",
      labelRenderedSizeThreshold: 7,
      minCameraRatio: 0.001,
      maxCameraRatio: 1.5,
      stagePadding: 40,
      defaultEdgeColor: "rgba(100,116,139,0.3)",
    });
    sigma.setCustomBBox({ x: [-1000, 1000], y: [-1000, 1000] });

    sigma.on("clickNode", ({ node }) => {
      onSelectRef.current(node);
      const childCount = graph.getNodeAttribute(node, "childCount") as number;
      if (childCount > 0) onToggleRef.current(node);
    });
    sigma.on("clickStage", () => onSelectRef.current(null));
    sigma.on("enterNode", () => {
      containerRef.current!.style.cursor = "pointer";
    });
    sigma.on("leaveNode", () => {
      containerRef.current!.style.cursor = "default";
    });

    sigmaRef.current = sigma;
    return () => {
      sigma.kill();
      sigmaRef.current = null;
    };
    // graph/index are stable for the lifetime of the page
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, index]);

  // ---- visibility + layout on expansion change --------------------------------
  useEffect(() => {
    const sigma = sigmaRef.current;
    if (!sigma) return;

    // Lay out children of any expanded node that hasn't been laid out yet,
    // walking top-down so parents always have positions first.
    const layoutIfNeeded = (id: string) => {
      if (laidOutRef.current.has(id)) return;
      layoutChildren(graph, index, id);
      laidOutRef.current.add(id);
    };

    const visible = new Set<string>();
    const walk = (id: string) => {
      visible.add(id);
      if (!expanded.has(id)) return;
      layoutIfNeeded(id);
      for (const kid of index.children.get(id) ?? []) walk(kid);
    };
    for (const n of index.byId.values()) {
      if (n.depth === 0) walk(n.id);
    }

    graph.forEachNode((id) => {
      graph.setNodeAttribute(id, "hidden", !visible.has(id));
    });
    graph.forEachEdge((edge, _attrs, source, target) => {
      graph.setEdgeAttribute(
        edge,
        "hidden",
        !visible.has(source) || !visible.has(target),
      );
    });
    sigma.refresh();
  }, [expanded, graph, index]);

  // ---- selection highlight ------------------------------------------------------
  useEffect(() => {
    graph.forEachNode((id) => {
      graph.setNodeAttribute(id, "highlighted", id === selectedId);
    });
    sigmaRef.current?.refresh();
  }, [selectedId, graph]);

  // ---- overlay colors -------------------------------------------------------------
  useEffect(() => {
    graph.forEachNode((id) => {
      const color = overlayColors
        ? (overlayColors.get(id) ?? "#293548")
        : baseColor(id, index);
      graph.setNodeAttribute(id, "color", color);
    });
    sigmaRef.current?.refresh();
  }, [overlayColors, graph, index]);

  // ---- camera focus ------------------------------------------------------------
  useEffect(() => {
    const sigma = sigmaRef.current;
    if (!sigma || !focus) return;
    const { id } = focus;
    if (!graph.hasNode(id)) return;
    // wait a tick so layout/visibility updates land first
    const t = setTimeout(() => {
      const display = sigma.getNodeDisplayData(id);
      if (!display) return;
      const depth = graph.getNodeAttribute(id, "depth") as number;
      const span = ZOOM_SPAN[Math.min(depth + 1, 4)] ?? 200;
      sigma.getCamera().animate(
        { x: display.x, y: display.y, ratio: span / 2000 },
        { duration: 450 },
      );
    }, 30);
    return () => clearTimeout(t);
  }, [focus, graph]);

  return <div ref={containerRef} className="absolute inset-0" />;
}
