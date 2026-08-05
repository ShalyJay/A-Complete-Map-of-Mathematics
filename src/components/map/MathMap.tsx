"use client";

import { useEffect, useRef } from "react";
import Sigma from "sigma";
import type { Settings } from "sigma/settings";
import type { NodeDisplayData, PartialButFor } from "sigma/types";
import EdgeCurveProgram, { EdgeCurvedArrowProgram } from "@sigma/edge-curve";
import type Graph from "graphology";
import type { NodeIndex } from "./graphStore";
import { baseColor } from "./graphStore";
import { computeLayout, computeLevels, RADII } from "./layout";

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

/** camera span (graph units) when focusing a node of the given depth */
const ZOOM_SPAN: Record<number, number> = { 0: 1800, 1: 1250, 2: 950, 3: 700, 4: 450 };
const DIM_COLOR = "rgba(51,65,85,0.35)";
const ANIM_MS = 500;
/** bubbles at least this big get their label drawn inside the circle */
const INSIDE_LABEL_SIZE = 13;

type LabelData = PartialButFor<NodeDisplayData, "x" | "y" | "size" | "label" | "color"> & {
  sublabel?: string;
};

/** Word-wrap `text` to fit `maxWidth`, at most `maxLines` lines. */
function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth || !line) {
      line = candidate;
    } else {
      lines.push(line);
      line = word;
      if (lines.length === maxLines - 1) break;
    }
  }
  if (line && lines.length < maxLines) lines.push(line);
  const rest = words.slice(lines.join(" ").split(/\s+/).length).length;
  if (rest > 0 && lines.length > 0) {
    let last = lines[lines.length - 1];
    while (ctx.measureText(`${last}…`).width > maxWidth && last.length > 3) {
      last = last.slice(0, -1);
    }
    lines[lines.length - 1] = `${last}…`;
  }
  return lines;
}

/**
 * Fit a label inside a circle of the given radius: wrap to up to 4 lines and
 * shrink the font until every line fits the chord at its own height.
 */
function fitInsideCircle(
  ctx: CanvasRenderingContext2D,
  label: string,
  radius: number,
  font: string,
): { lines: string[]; fontSize: number } {
  let fontSize = Math.max(8, Math.min(16, radius / 2.4));
  for (let attempt = 0; attempt < 7; attempt++) {
    ctx.font = `600 ${fontSize}px ${font}`;
    const lines = wrapText(ctx, label, radius * 1.8, 4);
    const lineHeight = fontSize + 2;
    let ok = lines.length * lineHeight <= radius * 1.65;
    if (ok) {
      for (let j = 0; j < lines.length; j++) {
        const dy = Math.abs((j - (lines.length - 1) / 2) * lineHeight) + fontSize * 0.4;
        const chord = 2 * Math.sqrt(Math.max(0, radius * radius - dy * dy)) * 0.94;
        if (ctx.measureText(lines[j]).width > chord) {
          ok = false;
          break;
        }
      }
    }
    if (ok || fontSize <= 6.5) return { lines, fontSize };
    fontSize = Math.max(6.5, fontSize * 0.86);
  }
  ctx.font = `600 ${fontSize}px ${font}`;
  return { lines: wrapText(ctx, label, radius * 1.7, 4), fontSize };
}

/** Render a fitted label (plus optional sublabel) centered inside a circle. */
function drawInsideLabel(
  ctx: CanvasRenderingContext2D,
  data: { x: number; y: number; size: number; label: string; sublabel?: string },
  font: string,
): void {
  const { lines, fontSize } = fitInsideCircle(ctx, data.label, data.size, font);
  const lineHeight = fontSize + 2;
  const sub = data.sublabel;
  const subFont = Math.max(6.5, fontSize * 0.75);
  const blockShift = sub ? -(subFont + 3) / 2 : 0;
  ctx.textAlign = "center";
  ctx.fillStyle = "#ffffff";
  ctx.font = `600 ${fontSize}px ${font}`;
  lines.forEach((line, i) => {
    const y =
      data.y + blockShift + (i - (lines.length - 1) / 2) * lineHeight + fontSize * 0.35;
    ctx.fillText(line, data.x, y);
  });
  if (sub) {
    ctx.font = `500 ${subFont}px ${font}`;
    ctx.fillStyle = "rgba(255,255,255,0.72)";
    const y = data.y + blockShift + ((lines.length - 1) / 2) * lineHeight + fontSize * 0.35;
    ctx.fillText(sub, data.x, y + subFont + 4);
  }
  ctx.textAlign = "left";
}

/** Draw the label inside big bubbles, beside small dots. */
function drawNodeLabel(
  ctx: CanvasRenderingContext2D,
  data: LabelData,
  settings: Settings,
): void {
  if (!data.label) return;
  if (data.size >= INSIDE_LABEL_SIZE) {
    drawInsideLabel(
      ctx,
      { x: data.x, y: data.y, size: data.size, label: data.label, sublabel: data.sublabel },
      settings.labelFont,
    );
  } else {
    ctx.font = `${settings.labelWeight} ${settings.labelSize}px ${settings.labelFont}`;
    ctx.fillStyle = "#cbd5e1";
    ctx.fillText(data.label, data.x + data.size + 4, data.y + settings.labelSize / 3);
  }
}

/**
 * Hover: dark pill beside small dots. Big bubbles draw nothing here — sigma
 * repaints the hovered node's circle ON TOP of whatever this function draws,
 * which would bury an inside-the-circle label. Their hover label is drawn on
 * the top overlay canvas instead (see drawTop in the component).
 */
function drawNodeHover(
  ctx: CanvasRenderingContext2D,
  data: LabelData,
  settings: Settings,
): void {
  if (!data.label) return;
  if (data.size >= INSIDE_LABEL_SIZE) return;
  const size = settings.labelSize;
  ctx.font = `${settings.labelWeight} ${size}px ${settings.labelFont}`;
  const w = ctx.measureText(data.label).width;
  const x = data.x + data.size + 4;
  const y = data.y;
  ctx.fillStyle = "rgba(15,23,42,0.92)";
  ctx.beginPath();
  ctx.roundRect(x - 5, y - size / 2 - 5, w + 10, size + 10, 6);
  ctx.fill();
  ctx.fillStyle = "#f1f5f9";
  ctx.fillText(data.label, x, y + size / 3);
}

/** Full up+down closure of a node in the depends-on DAG. */
function dependencyChain(index: NodeIndex, id: string): Set<string> {
  const chain = new Set<string>();
  const walk = (start: string, dir: "depsOf" | "dependentsOf") => {
    const stack = [start];
    while (stack.length > 0 && chain.size < 500) {
      const cur = stack.pop()!;
      for (const next of index[dir].get(cur) ?? []) {
        if (chain.has(next) || next === id) continue;
        chain.add(next);
        stack.push(next);
      }
    }
  };
  walk(id, "depsOf");
  walk(id, "dependentsOf");
  return chain;
}

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
  const ringsRef = useRef<HTMLCanvasElement>(null);
  const topRef = useRef<HTMLCanvasElement>(null);
  const sigmaRef = useRef<Sigma | null>(null);
  const onSelectRef = useRef(onSelect);
  const onToggleRef = useRef(onToggleExpand);
  onSelectRef.current = onSelect;
  onToggleRef.current = onToggleExpand;

  /** latest layout targets (also used for camera focus) */
  const targetsRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const levelsRef = useRef<Map<string, number> | null>(null);
  const prevVisibleRef = useRef<Set<string>>(new Set());
  const animRef = useRef<number | null>(null);
  /** hover state (transient) and selection state (persistent), read by reducers */
  const hoverRef = useRef<string | null>(null);
  const hoverChainRef = useRef<Set<string>>(new Set());
  const selectedRef = useRef<string | null>(null);
  const selChainRef = useRef<Set<string>>(new Set());

  /** the tracing focus right now: hover wins, else a selected node with a chain */
  const activeTrace = (): { id: string; chain: Set<string> } | null => {
    if (hoverRef.current) return { id: hoverRef.current, chain: hoverChainRef.current };
    if (selectedRef.current && selChainRef.current.size > 0) {
      return { id: selectedRef.current, chain: selChainRef.current };
    }
    return null;
  };
  const activeTraceRef = useRef(activeTrace);
  activeTraceRef.current = activeTrace;

  // ---- init sigma ------------------------------------------------------------
  useEffect(() => {
    if (!containerRef.current) return;

    const sigma = new Sigma(graph, containerRef.current, {
      allowInvalidContainer: true,
      renderLabels: true,
      labelColor: { color: "#cbd5e1" },
      labelSize: 12,
      labelWeight: "500",
      labelFont: "Inter, ui-sans-serif, system-ui",
      labelRenderedSizeThreshold: 5,
      labelDensity: 0.8,
      labelGridCellSize: 80,
      minCameraRatio: 0.001,
      maxCameraRatio: 1.4,
      stagePadding: 40,
      zIndex: true,
      defaultEdgeColor: "rgba(100,116,139,0.3)",
      defaultDrawNodeLabel: drawNodeLabel,
      defaultDrawNodeHover: drawNodeHover,
      edgeProgramClasses: {
        curved: EdgeCurveProgram,
        curvedArrow: EdgeCurvedArrowProgram,
      },
      nodeReducer: (node, data) => {
        const trace = activeTraceRef.current();
        const res = { ...data };
        if (!trace) {
          if (node === selectedRef.current) {
            res.forceLabel = true;
            res.zIndex = 3;
          }
          return res;
        }
        if (node === trace.id) {
          res.zIndex = 3;
          res.forceLabel = true;
        } else if (trace.chain.has(node)) {
          res.zIndex = 2;
          res.forceLabel = true;
        } else {
          res.color = DIM_COLOR;
          res.label = "";
          res.zIndex = 0;
        }
        return res;
      },
      edgeReducer: (edge, data) => {
        const trace = activeTraceRef.current();
        if (!trace) return data;
        const res = { ...data };
        const [s, t] = graph.extremities(edge);
        const inChain = (n: string) => n === trace.id || trace.chain.has(n);
        if (!(inChain(s) && inChain(t))) res.hidden = true;
        return res;
      },
    });
    sigma.setCustomBBox({ x: [-RADII.max, RADII.max], y: [-RADII.max, RADII.max] });
    // start focused on the branch ring rather than the whole empty canvas
    sigma.getCamera().setState({ ratio: 0.38 });

    sigma.on("clickNode", ({ node }) => {
      onSelectRef.current(node);
      const childCount = graph.getNodeAttribute(node, "childCount") as number;
      if (childCount > 0) onToggleRef.current(node);
    });
    sigma.on("clickStage", () => onSelectRef.current(null));
    sigma.on("enterNode", ({ node }) => {
      containerRef.current!.style.cursor = "pointer";
      const chain = dependencyChain(index, node);
      if (chain.size > 0) {
        const n = index.byId.get(node);
        if (n?.parentId) chain.add(n.parentId);
        hoverRef.current = node;
        hoverChainRef.current = chain;
      }
      // always refresh so the top canvas can redraw the hovered bubble's label
      sigma.refresh({ skipIndexation: true });
    });
    sigma.on("leaveNode", () => {
      containerRef.current!.style.cursor = "default";
      hoverRef.current = null;
      hoverChainRef.current = new Set();
      sigma.refresh({ skipIndexation: true });
    });

    // list of depends-on edges (source = prerequisite, target = dependent),
    // drawn on the top canvas so derivation lines sit above the bubbles
    const depEdges: { s: string; t: string }[] = [];
    graph.forEachEdge((_e, attrs, s, t) => {
      if (attrs.edgeKind === "depends-on") depEdges.push({ s, t });
    });

    const sizeCanvas = (canvas: HTMLCanvasElement) => {
      const container = containerRef.current!;
      const w = container.clientWidth;
      const h = container.clientHeight;
      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      const ctx = canvas.getContext("2d")!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      return ctx;
    };

    /** displayed pixel radius of a node at the current zoom */
    const pxSize = (v: number) => {
      const s = sigma as unknown as { scaleSize?: (v: number) => number };
      return typeof s.scaleSize === "function"
        ? s.scaleSize(v)
        : v / Math.sqrt(sigma.getCamera().ratio);
    };

    // ---- background: concentric ring guides -------------------------------------
    const drawRings = () => {
      if (!ringsRef.current || !containerRef.current) return;
      const ctx = sizeCanvas(ringsRef.current);
      const c = sigma.graphToViewport({ x: 0, y: 0 });
      const p = sigma.graphToViewport({ x: 100, y: 0 });
      const scale = Math.hypot(p.x - c.x, p.y - c.y) / 100;

      // warm glow at the center — the direction axioms and foundations point
      const glowR = Math.max(1, RADII.ring * 0.75 * scale);
      const grad = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, glowR);
      grad.addColorStop(0, "rgba(251,191,36,0.07)");
      grad.addColorStop(1, "rgba(251,191,36,0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(c.x, c.y, glowR, 0, 2 * Math.PI);
      ctx.fill();

      ctx.lineWidth = 1;
      ctx.strokeStyle = "rgba(148,163,184,0.05)";
      for (const r of [RADII.ring, ...RADII.childRing]) {
        ctx.beginPath();
        ctx.arc(c.x, c.y, r * scale, 0, 2 * Math.PI);
        ctx.stroke();
      }
    };

    // ---- foreground: derivation arrows + selection ring above the bubbles --------
    const nodeXY = (id: string) =>
      sigma.graphToViewport({
        x: graph.getNodeAttribute(id, "x") as number,
        y: graph.getNodeAttribute(id, "y") as number,
      });

    const drawArrow = (
      ctx: CanvasRenderingContext2D,
      s: string,
      t: string,
      color: string,
      width: number,
    ) => {
      const p1 = nodeXY(s);
      const p2 = nodeXY(t);
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const len = Math.hypot(dx, dy);
      if (len < 4) return;
      const r1 = pxSize(graph.getNodeAttribute(s, "size") as number);
      const r2 = pxSize(graph.getNodeAttribute(t, "size") as number);
      // control point offset perpendicular to the segment (matches the curved
      // edge feel of the base layer)
      const cx = (p1.x + p2.x) / 2 - dy * 0.18;
      const cy = (p1.y + p2.y) / 2 + dx * 0.18;
      // trim ends to the node boundaries
      const d1 = Math.hypot(cx - p1.x, cy - p1.y);
      const a1 = { x: p1.x + ((cx - p1.x) / d1) * (r1 + 1), y: p1.y + ((cy - p1.y) / d1) * (r1 + 1) };
      const d2 = Math.hypot(p2.x - cx, p2.y - cy);
      const tipGap = r2 + 2;
      const tip = { x: p2.x - ((p2.x - cx) / d2) * tipGap, y: p2.y - ((p2.y - cy) / d2) * tipGap };

      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(a1.x, a1.y);
      ctx.quadraticCurveTo(cx, cy, tip.x, tip.y);
      ctx.stroke();

      // arrowhead pointing along the curve tangent at the tip
      const tx = (p2.x - cx) / d2;
      const ty = (p2.y - cy) / d2;
      const ah = Math.max(5, Math.min(11, 4 + width * 2.2));
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(tip.x + tx * ah, tip.y + ty * ah);
      ctx.lineTo(tip.x - ty * (ah * 0.45), tip.y + tx * (ah * 0.45));
      ctx.lineTo(tip.x + ty * (ah * 0.45), tip.y - tx * (ah * 0.45));
      ctx.closePath();
      ctx.fill();
    };

    /** nearest ancestor (or self) that is currently rendered on the map */
    const visibleAnchor = (id: string): string | null => {
      let cur: string | undefined = id;
      while (cur) {
        if (graph.hasNode(cur) && !(graph.getNodeAttribute(cur, "hidden") as boolean)) {
          return cur;
        }
        cur = index.byId.get(cur)?.parentId ?? undefined;
      }
      return null;
    };

    const drawTop = () => {
      if (!topRef.current || !containerRef.current) return;
      const ctx = sizeCanvas(topRef.current);
      const trace = activeTraceRef.current();

      const isShown = (id: string) =>
        graph.hasNode(id) && !(graph.getNodeAttribute(id, "hidden") as boolean);

      if (trace) {
        // tracing: draw only the pinned/hovered chain, bright
        const inChain = (n: string) => n === trace.id || trace.chain.has(n);
        for (const { s, t } of depEdges) {
          if (!isShown(s) || !isShown(t)) continue;
          if (inChain(s) && inChain(t)) drawArrow(ctx, s, t, "rgba(251,146,60,0.95)", 2.2);
        }
      } else {
        // at rest: draw direct arrows where both ends are on screen, and roll
        // hidden endpoints up to their nearest visible bubble so collapsed
        // sections still show their interdependencies as aggregated arcs
        const aggregated = new Map<string, { s: string; t: string; n: number }>();
        for (const { s, t } of depEdges) {
          if (isShown(s) && isShown(t)) {
            drawArrow(ctx, s, t, "rgba(251,146,60,0.5)", 1.2);
            continue;
          }
          const vs = visibleAnchor(s);
          const vt = visibleAnchor(t);
          if (!vs || !vt || vs === vt) continue;
          const key = `${vs}\u0000${vt}`;
          const agg = aggregated.get(key);
          if (agg) agg.n += 1;
          else aggregated.set(key, { s: vs, t: vt, n: 1 });
        }
        for (const { s, t, n } of aggregated.values()) {
          const width = Math.min(3.5, 0.9 + Math.log2(n) * 0.7);
          const alpha = Math.min(0.55, 0.25 + n * 0.05);
          drawArrow(ctx, s, t, `rgba(251,146,60,${alpha})`, width);
        }
      }

      // selection halo: a bright ring + soft amber glow around the picked node
      const sel = selectedRef.current;
      if (sel && isShown(sel)) {
        const p = nodeXY(sel);
        const r = pxSize(graph.getNodeAttribute(sel, "size") as number);
        ctx.lineWidth = 6;
        ctx.strokeStyle = "rgba(251,191,36,0.28)";
        ctx.beginPath();
        ctx.arc(p.x, p.y, r + 8, 0, 2 * Math.PI);
        ctx.stroke();
        ctx.lineWidth = 2;
        ctx.strokeStyle = "rgba(255,255,255,0.92)";
        ctx.beginPath();
        ctx.arc(p.x, p.y, r + 4, 0, 2 * Math.PI);
        ctx.stroke();
      }

      // sigma repaints the hovered node's circle above its own labels layer,
      // which would hide an inside-the-circle label — so redraw it up here
      const hovered = (sigma as unknown as { hoveredNode: string | null }).hoveredNode;
      if (hovered && isShown(hovered)) {
        const r = pxSize(graph.getNodeAttribute(hovered, "size") as number);
        if (r >= INSIDE_LABEL_SIZE) {
          const p = nodeXY(hovered);
          drawInsideLabel(
            ctx,
            {
              x: p.x,
              y: p.y,
              size: r,
              label: graph.getNodeAttribute(hovered, "label") as string,
              sublabel: graph.getNodeAttribute(hovered, "sublabel") as string | undefined,
            },
            "Inter, ui-sans-serif, system-ui",
          );
        }
      }
    };

    const drawDecorations = () => {
      drawRings();
      drawTop();
    };
    sigma.on("afterRender", drawDecorations);

    sigmaRef.current = sigma;
    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
      sigma.kill();
      sigmaRef.current = null;
    };
    // graph/index are stable for the lifetime of the page
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, index]);

  // ---- layout + visibility + movement animation --------------------------------
  useEffect(() => {
    const sigma = sigmaRef.current;
    if (!sigma) return;
    if (!levelsRef.current) levelsRef.current = computeLevels(index);
    const levels = levelsRef.current;

    // visible = expansion walk + the selected node's derivation chain
    const visible = new Set<string>();
    const walk = (id: string) => {
      visible.add(id);
      if (!expanded.has(id)) return;
      for (const kid of index.children.get(id) ?? []) walk(kid);
    };
    for (const n of index.byId.values()) if (n.depth === 0) walk(n.id);

    const chain = new Set<string>();
    if (selectedId && index.byId.has(selectedId)) {
      visible.add(selectedId);
      for (const id of dependencyChain(index, selectedId)) {
        chain.add(id);
        visible.add(id);
      }
    }

    const targets = computeLayout(index, expanded, chain, levels);
    targetsRef.current = targets;

    // animate: existing nodes glide to new spots, newcomers grow out of parent
    const anims: {
      id: string;
      x0: number;
      y0: number;
      s0: number;
      x1: number;
      y1: number;
      s1: number;
    }[] = [];
    const finalSize = (id: string) =>
      (graph.getNodeAttribute(id, "size") as number) || 4;

    for (const id of visible) {
      const t = targets.get(id);
      if (!t) continue;
      const wasVisible = prevVisibleRef.current.has(id);
      const s1 = finalSize(id);
      if (wasVisible) {
        const x0 = graph.getNodeAttribute(id, "x") as number;
        const y0 = graph.getNodeAttribute(id, "y") as number;
        if (Math.abs(x0 - t.x) > 0.5 || Math.abs(y0 - t.y) > 0.5) {
          anims.push({ id, x0, y0, s0: s1, x1: t.x, y1: t.y, s1 });
        }
      } else {
        const parentId = index.byId.get(id)?.parentId;
        const pt = parentId ? targets.get(parentId) : undefined;
        const x0 = pt ? pt.x : t.x * 0.3;
        const y0 = pt ? pt.y : t.y * 0.3;
        graph.mergeNodeAttributes(id, { x: x0, y: y0 });
        anims.push({ id, x0, y0, s0: s1 * 0.2, x1: t.x, y1: t.y, s1 });
      }
    }

    graph.forEachNode((id) => {
      graph.setNodeAttribute(id, "hidden", !visible.has(id));
    });
    graph.forEachEdge((edge, attrs, source, target) => {
      // depends-on edges live on the top canvas, never on the base layer
      graph.setEdgeAttribute(
        edge,
        "hidden",
        attrs.edgeKind === "depends-on" || !visible.has(source) || !visible.has(target),
      );
    });
    prevVisibleRef.current = visible;

    if (animRef.current) cancelAnimationFrame(animRef.current);
    if (anims.length > 0 && anims.length <= 2500) {
      const start = performance.now();
      const tick = (now: number) => {
        const t = Math.min(1, (now - start) / ANIM_MS);
        const ease = 1 - Math.pow(1 - t, 3);
        for (const a of anims) {
          graph.mergeNodeAttributes(a.id, {
            x: a.x0 + (a.x1 - a.x0) * ease,
            y: a.y0 + (a.y1 - a.y0) * ease,
            size: a.s0 + (a.s1 - a.s0) * ease,
          });
        }
        sigma.refresh({ skipIndexation: true });
        if (t < 1) animRef.current = requestAnimationFrame(tick);
        else animRef.current = null;
      };
      animRef.current = requestAnimationFrame(tick);
    } else {
      for (const [id, t] of targets) {
        if (visible.has(id)) graph.mergeNodeAttributes(id, { x: t.x, y: t.y });
      }
      sigma.refresh();
    }
  }, [expanded, selectedId, graph, index]);

  // ---- selection: persistent chain trace + halo ---------------------------------
  useEffect(() => {
    selectedRef.current = selectedId;
    const chain = selectedId ? dependencyChain(index, selectedId) : new Set<string>();
    if (chain.size > 0 && selectedId) {
      const n = index.byId.get(selectedId);
      if (n?.parentId) chain.add(n.parentId);
    }
    selChainRef.current = chain;
    sigmaRef.current?.refresh({ skipIndexation: true });
  }, [selectedId, graph, index]);

  // ---- overlay colors -------------------------------------------------------------
  useEffect(() => {
    graph.forEachNode((id) => {
      const color = overlayColors
        ? (overlayColors.get(id) ?? "#293548")
        : baseColor(id, index);
      graph.setNodeAttribute(id, "color", color);
    });
    sigmaRef.current?.refresh({ skipIndexation: true });
  }, [overlayColors, graph, index]);

  // ---- camera focus ------------------------------------------------------------
  useEffect(() => {
    const sigma = sigmaRef.current;
    if (!sigma || !focus) return;
    const { id } = focus;
    if (!graph.hasNode(id)) return;
    // wait a tick so the layout effect lands first
    const t = setTimeout(() => {
      const target = targetsRef.current.get(id);
      if (!target) return;
      const depth = graph.getNodeAttribute(id, "depth") as number;
      // when expanding, frame the node together with its children ring: aim
      // the camera a bit beyond the node, along its angle
      const isExpanded = expanded.has(id);
      if (depth === 0 && !isExpanded) {
        // collapsed branch (home): frame the whole ring
        const framed = sigma.viewportToFramedGraph(sigma.graphToViewport({ x: 0, y: 0 }));
        sigma.getCamera().animate({ x: framed.x, y: framed.y, ratio: 0.38 }, { duration: 500 });
        return;
      }
      const childRing = RADII.childRing[Math.min(depth, RADII.childRing.length - 1)];
      let cx = target.x;
      let cy = target.y;
      if (isExpanded) {
        const angle = Math.atan2(target.y, target.x);
        const midR = (Math.hypot(target.x, target.y) + childRing) / 2;
        cx = midR * Math.cos(angle);
        cy = midR * Math.sin(angle);
      }
      const span = ZOOM_SPAN[Math.min(isExpanded ? depth + 1 : depth + 2, 4)] ?? 450;
      // the detail panel covers the right ~35% of the screen; nudge the camera
      // right so the focused content lands in the uncovered area
      if (selectedId) cx += span * 0.18;
      const framed = sigma.viewportToFramedGraph(sigma.graphToViewport({ x: cx, y: cy }));
      sigma.getCamera().animate(
        { x: framed.x, y: framed.y, ratio: span / (2 * RADII.max) },
        { duration: 500 },
      );
    }, 30);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus, graph]);

  return (
    <div className="absolute inset-0">
      <canvas ref={ringsRef} className="pointer-events-none absolute inset-0 h-full w-full" />
      <div ref={containerRef} className="absolute inset-0" />
      <canvas
        ref={topRef}
        className="pointer-events-none absolute inset-0 z-[5] h-full w-full"
      />
    </div>
  );
}
