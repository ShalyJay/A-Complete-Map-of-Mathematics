"use client";

/**
 * 3D render of the map: a navigable space you can rotate and zoom freely.
 *
 * The 8 grand branches share a sphere, staggered alternately above and below
 * the equator; expanding a bubble fans its children across a spherical cap
 * around its outward direction, so open sections spread into the z axis as
 * well as x/y. Axioms sit on inner shells,
 * theorems on outer shells by derivation level, and dependency arrows are 3D
 * chords through the space. Orbit to rotate, scroll to zoom, right-drag to pan.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Billboard, OrbitControls, QuadraticBezierLine, Stars, Text } from "@react-three/drei";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import type Graph from "graphology";
import type { NodeIndex } from "./graphStore";
import { computeLevels } from "./layout";
import { computeLayout3D, BRANCH_TILT, RADII3, type Vec3 } from "./layout3d";
import type { FocusRequest } from "./MathMap";

interface Props {
  graph: Graph;
  index: NodeIndex;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  expanded: Set<string>;
  onToggleExpand: (id: string) => void;
  focus: FocusRequest | null;
  overlayColors: Map<string, string> | null;
}

/** camera distance when focusing a node of the given depth */
const ZOOM_DIST: Record<number, number> = { 0: 1450, 1: 1000, 2: 720, 3: 520, 4: 380 };
const HOME_DIST = 1500;
const DIM_COLOR = "#1c2738";
/** bubbles at least this big carry their label on the sphere itself */
const INSIDE_LABEL_SIZE = 14;

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

interface NodeDatum {
  id: string;
  size: number;
  label: string;
  sublabel?: string;
  type: string;
  depth: number;
  childCount: number;
  parentId: string | null;
}

// ---------------------------------------------------------------------------
// single node: sphere + billboarded label(s) + selection ring
// ---------------------------------------------------------------------------
const NodeItem = memo(function NodeItem({
  nd,
  color,
  dimmed,
  highlighted,
  selected,
  showLabel,
  geometry,
  register,
  onClickNode,
  onHoverNode,
}: {
  nd: NodeDatum;
  color: string;
  dimmed: boolean;
  highlighted: boolean;
  selected: boolean;
  showLabel: boolean;
  geometry: THREE.SphereGeometry;
  register: (id: string, g: THREE.Group | null) => void;
  onClickNode: (id: string) => void;
  onHoverNode: (id: string | null) => void;
}) {
  const inside = nd.size >= INSIDE_LABEL_SIZE;
  const labelColor = dimmed ? "#475569" : "#f1f5f9";
  return (
    <group ref={(g) => register(nd.id, g)}>
      <mesh
        geometry={geometry}
        scale={nd.size}
        onClick={(e) => {
          e.stopPropagation();
          // a pan/rotate drag that happens to start on a bubble is not a click
          const ne = e.nativeEvent;
          if (e.delta > 5 || ne.shiftKey || ne.metaKey || ne.ctrlKey) return;
          onClickNode(nd.id);
        }}
        onPointerOver={(e) => {
          e.stopPropagation();
          onHoverNode(nd.id);
        }}
        onPointerOut={() => onHoverNode(null)}
      >
        <meshStandardMaterial
          color={dimmed ? DIM_COLOR : color}
          emissive={dimmed ? "#000000" : color}
          emissiveIntensity={highlighted || selected ? 0.6 : 0.22}
          transparent
          opacity={dimmed ? 0.22 : 1}
          roughness={0.5}
          metalness={0.08}
        />
      </mesh>

      {selected && (
        <Billboard>
          <mesh>
            <ringGeometry args={[nd.size * 1.18, nd.size * 1.18 + Math.max(1.5, nd.size * 0.06), 48]} />
            <meshBasicMaterial color="#fbbf24" transparent opacity={0.9} side={THREE.DoubleSide} />
          </mesh>
        </Billboard>
      )}

      {showLabel && !dimmed && (
        <Billboard>
          {inside ? (
            <>
              <Text
                position={[0, nd.sublabel ? nd.size * 0.12 : 0, nd.size * 1.06]}
                fontSize={Math.max(11, nd.size * 0.3)}
                maxWidth={Math.max(nd.size * 1.5, 34)}
                textAlign="center"
                anchorX="center"
                anchorY="middle"
                color={dimmed ? "#475569" : "#ffffff"}
                outlineWidth={nd.size * 0.022}
                outlineColor="#0b1220"
              >
                {nd.label}
              </Text>
              {nd.sublabel && (
                <Text
                  position={[0, -nd.size * 0.46, nd.size * 1.06]}
                  fontSize={Math.max(6, nd.size * 0.14)}
                  maxWidth={nd.size * 1.6}
                  textAlign="center"
                  anchorX="center"
                  anchorY="middle"
                  color="#cbd5e1"
                  outlineWidth={nd.size * 0.012}
                  outlineColor="#0b1220"
                >
                  {nd.sublabel}
                </Text>
              )}
            </>
          ) : (
            <Text
              position={[0, nd.size + 4, 0]}
              fontSize={highlighted || selected ? 15 : 11.5}
              maxWidth={190}
              textAlign="center"
              anchorX="center"
              anchorY="bottom"
              color={labelColor}
              outlineWidth={0.7}
              outlineColor="#0b1220"
            >
              {nd.label}
            </Text>
          )}
        </Billboard>
      )}
    </group>
  );
});

// ---------------------------------------------------------------------------
// dependency chord: a curve bowed away from the origin, endpoints tracking
// the animated node positions each frame
// ---------------------------------------------------------------------------
function DepEdge({
  a,
  b,
  color,
  width,
  opacity,
  positions,
}: {
  a: string;
  b: string;
  color: string;
  width: number;
  opacity: number;
  positions: React.RefObject<Map<string, THREE.Vector3>>;
}) {
  const ref = useRef<{
    setPoints: (
      start: THREE.Vector3,
      end: THREE.Vector3,
      mid: THREE.Vector3,
    ) => void;
  } | null>(null);
  const mid = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    const pa = positions.current?.get(a);
    const pb = positions.current?.get(b);
    if (!pa || !pb || !ref.current) return;
    mid.copy(pa).add(pb).multiplyScalar(0.5);
    const push = pa.distanceTo(pb) * 0.16 + 18;
    if (mid.lengthSq() < 1) mid.set(0, 0, push);
    else mid.setLength(mid.length() + push);
    ref.current.setPoints(pa, pb, mid);
  });
  return (
    <QuadraticBezierLine
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ref={ref as any}
      start={[0, 0, 0]}
      end={[0, 0, 0]}
      color={color}
      lineWidth={width}
      transparent
      opacity={opacity}
      depthWrite={false}
    />
  );
}

// ---------------------------------------------------------------------------
// scene: layout, animation, camera focus, interactions
// ---------------------------------------------------------------------------
function Scene({
  graph,
  index,
  selectedId,
  onSelect,
  expanded,
  onToggleExpand,
  focus,
  overlayColors,
}: Props) {
  const [hoverId, setHoverId] = useState<string | null>(null);
  const levels = useMemo(() => computeLevels(index), [index]);
  const sphereGeo = useMemo(() => new THREE.SphereGeometry(1, 28, 28), []);
  const { gl, camera } = useThree();

  const onSelectRef = useRef(onSelect);
  const onToggleRef = useRef(onToggleExpand);
  onSelectRef.current = onSelect;
  onToggleRef.current = onToggleExpand;

  // ---- selection chain / visibility / layout targets -----------------------
  const selChain = useMemo(() => {
    if (!selectedId) return new Set<string>();
    const c = dependencyChain(index, selectedId);
    if (c.size > 0) {
      const n = index.byId.get(selectedId);
      if (n?.parentId) c.add(n.parentId);
    }
    return c;
  }, [selectedId, index]);

  const visible = useMemo(() => {
    const vis = new Set<string>();
    for (const n of index.byId.values()) if (n.depth === 0) vis.add(n.id);
    const isOpen = (id: string) =>
      expanded.has(id) && index.ancestorsOf(id).every((a) => expanded.has(a));
    for (const id of expanded) {
      if (!isOpen(id)) continue;
      vis.add(id);
      for (const k of index.children.get(id) ?? []) vis.add(k);
    }
    if (selectedId) {
      vis.add(selectedId);
      for (const c of selChain) vis.add(c);
    }
    return vis;
  }, [index, expanded, selectedId, selChain]);

  const targets = useMemo(
    () => computeLayout3D(index, expanded, selChain, levels),
    [index, expanded, selChain, levels],
  );
  const targetsRef = useRef(targets);
  targetsRef.current = targets;

  // ---- hover / pinned dependency trace --------------------------------------
  const trace = useMemo(() => {
    const tryId = (id: string | null) => {
      if (!id) return null;
      const chain = dependencyChain(index, id);
      if (chain.size === 0) return null;
      const n = index.byId.get(id);
      if (n?.parentId) chain.add(n.parentId);
      return { id, chain };
    };
    return tryId(hoverId) ?? tryId(selectedId);
  }, [hoverId, selectedId, index]);

  // ---- node render data ------------------------------------------------------
  const nodes = useMemo(() => {
    const out: NodeDatum[] = [];
    for (const id of visible) {
      if (!targets.has(id)) continue;
      const n = index.byId.get(id);
      if (!n) continue;
      out.push({
        id,
        size: (graph.getNodeAttribute(id, "size") as number) || 5,
        label: n.title,
        sublabel: n.sublabel,
        type: n.type,
        depth: n.depth,
        childCount: n.childCount,
        parentId: n.parentId,
      });
    }
    return out;
  }, [visible, targets, index, graph]);
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;

  const colorOf = useCallback(
    (id: string): string =>
      overlayColors?.get(id) ?? ((graph.getNodeAttribute(id, "color") as string) || "#64748b"),
    [overlayColors, graph],
  );

  // ---- dependency chords ------------------------------------------------------
  const depPairs = useMemo(() => {
    const out: { from: string; to: string }[] = [];
    for (const [dep, prereqs] of index.depsOf) {
      for (const p of prereqs) out.push({ from: p, to: dep });
    }
    return out;
  }, [index]);

  const edges = useMemo(() => {
    const anchor = (id: string): string | null => {
      if (visible.has(id)) return id;
      const anc = index.ancestorsOf(id);
      for (let i = anc.length - 1; i >= 0; i--) if (visible.has(anc[i])) return anc[i];
      return null;
    };
    const list: { key: string; a: string; b: string; color: string; width: number; opacity: number }[] = [];
    if (trace) {
      const inChain = (n: string) => n === trace.id || trace.chain.has(n);
      for (const { from, to } of depPairs) {
        if (inChain(from) && inChain(to) && visible.has(from) && visible.has(to)) {
          list.push({ key: `${from}|${to}`, a: from, b: to, color: "#fb923c", width: 2.6, opacity: 0.95 });
        }
      }
    } else {
      const agg = new Map<string, { a: string; b: string; n: number }>();
      for (const { from, to } of depPairs) {
        if (visible.has(from) && visible.has(to)) {
          list.push({ key: `${from}|${to}`, a: from, b: to, color: "#fb923c", width: 1.3, opacity: 0.5 });
          continue;
        }
        const va = anchor(from);
        const vb = anchor(to);
        if (!va || !vb || va === vb) continue;
        const key = `${va}|${vb}`;
        const e = agg.get(key);
        if (e) e.n++;
        else agg.set(key, { a: va, b: vb, n: 1 });
      }
      for (const { a, b, n } of agg.values()) {
        list.push({
          key: `agg:${a}|${b}`,
          a,
          b,
          color: "#fb923c",
          width: Math.min(3.5, 0.9 + Math.log2(n) * 0.7),
          opacity: Math.min(0.5, 0.2 + n * 0.05),
        });
      }
    }
    return list;
  }, [depPairs, visible, trace, index]);

  // ---- animated positions ------------------------------------------------------
  const curPos = useRef(new Map<string, THREE.Vector3>());
  const curScl = useRef(new Map<string, number>());
  const groups = useRef(new Map<string, THREE.Group>());
  const register = useCallback((id: string, g: THREE.Group | null) => {
    if (g) groups.current.set(id, g);
    else groups.current.delete(id);
  }, []);

  // forget positions of nodes that left the stage so they re-enter from their parent
  useEffect(() => {
    for (const id of [...curPos.current.keys()]) {
      if (!visible.has(id)) {
        curPos.current.delete(id);
        curScl.current.delete(id);
      }
    }
  }, [visible]);

  // ---- camera focus --------------------------------------------------------------
  const controlsRef = useRef<OrbitControlsImpl | null>(null);
  const desired = useRef({ target: new THREE.Vector3(), dist: HOME_DIST, active: false });
  const expandedRef = useRef(expanded);
  expandedRef.current = expanded;
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;

  useEffect(() => {
    if (!focus) return;
    const d = desired.current;
    const n = index.byId.get(focus.id);
    const t = targetsRef.current.get(focus.id);
    const isHome = expandedRef.current.size === 0 && (n?.depth ?? 0) === 0;
    if (isHome || !t || !n) {
      d.target.set(0, 0, 0);
      d.dist = HOME_DIST;
    } else {
      d.target.set(t.x, t.y, t.z);
      d.dist = ZOOM_DIST[Math.min(n.depth, 4)] ?? 600;
      // the detail panel covers the right side of the screen — shift the
      // camera target screen-right so the focused node lands left of it
      if (selectedRef.current) {
        const fwd = camera.getWorldDirection(new THREE.Vector3());
        const right = fwd.cross(camera.up).normalize();
        d.target.addScaledVector(right, d.dist * 0.2);
      }
    }
    d.active = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.nonce]);

  const tmp = useMemo(() => new THREE.Vector3(), []);
  useFrame((state, dtRaw) => {
    const dt = Math.min(dtRaw, 0.1);
    const k = 1 - Math.exp(-dt * 5.5);

    for (const nd of nodesRef.current) {
      const t = targetsRef.current.get(nd.id) as Vec3 | undefined;
      if (!t) continue;
      let cur = curPos.current.get(nd.id);
      if (!cur) {
        const pt = nd.parentId
          ? (curPos.current.get(nd.parentId) ??
            (targetsRef.current.has(nd.parentId)
              ? tmp.set(
                  targetsRef.current.get(nd.parentId)!.x,
                  targetsRef.current.get(nd.parentId)!.y,
                  targetsRef.current.get(nd.parentId)!.z,
                )
              : null))
          : null;
        cur = pt ? pt.clone() : new THREE.Vector3(t.x, t.y, t.z);
        curPos.current.set(nd.id, cur);
        curScl.current.set(nd.id, 0.02);
      }
      cur.lerp(tmp.set(t.x, t.y, t.z), k);
      const s0 = curScl.current.get(nd.id) ?? 1;
      const s = s0 + (1 - s0) * k;
      curScl.current.set(nd.id, s);
      const g = groups.current.get(nd.id);
      if (g) {
        g.position.copy(cur);
        g.scale.setScalar(Math.max(s, 0.001));
      }
    }

    // camera glide toward the focused node
    const ctrl = controlsRef.current;
    const d = desired.current;
    if (ctrl && d.active) {
      const k2 = 1 - Math.exp(-dt * 4);
      ctrl.target.lerp(d.target, k2);
      const cam = state.camera;
      const dir = cam.position.clone().sub(ctrl.target);
      const len = dir.length() || 1;
      const newLen = len + (d.dist - len) * k2;
      cam.position.copy(ctrl.target).add(dir.multiplyScalar(newLen / len));
      ctrl.update();
      if (ctrl.target.distanceTo(d.target) < 1.5 && Math.abs(newLen - d.dist) < 3) {
        d.active = false;
      }
    }
  });

  // ---- interactions ---------------------------------------------------------------
  const clickNode = useCallback(
    (id: string) => {
      const n = index.byId.get(id);
      if (!n) return;
      if (n.childCount > 0 && n.depth < 4) {
        onToggleRef.current(id);
        onSelectRef.current(id);
      } else {
        onSelectRef.current(id);
      }
    },
    [index],
  );

  const hoverNode = useCallback((id: string | null) => setHoverId(id), []);
  useEffect(() => {
    gl.domElement.style.cursor = hoverId ? "pointer" : "default";
  }, [hoverId, gl]);

  // Panning with Shift/⌘/Ctrl + left-drag is built into OrbitControls: when
  // the left button is set to ROTATE and a modifier is held at pointer-down,
  // it pans instead. Don't remap mouseButtons on keydown — the built-in
  // modifier check would then invert it back to rotate.

  const traceActive = trace !== null;
  const inTrace = useCallback(
    (id: string) => !!trace && (id === trace.id || trace.chain.has(id)),
    [trace],
  );

  return (
    <>
      {/* guide sphere: latitude rings trace the two staggered branch bands */}
      {[BRANCH_TILT, -BRANCH_TILT].map((t) => (
        <mesh key={t} position={[0, 0, Math.sin(t) * RADII3.ring]}>
          <torusGeometry args={[Math.cos(t) * RADII3.ring, 1.0, 8, 160]} />
          <meshBasicMaterial color="#1e293b" transparent opacity={0.5} />
        </mesh>
      ))}
      <mesh>
        <sphereGeometry args={[RADII3.ring, 28, 18]} />
        <meshBasicMaterial color="#16202f" wireframe transparent opacity={0.14} />
      </mesh>

      {edges.map((e) => (
        <DepEdge
          key={e.key}
          a={e.a}
          b={e.b}
          color={e.color}
          width={e.width}
          opacity={e.opacity}
          positions={curPos}
        />
      ))}

      {nodes.map((nd) => {
        const dimmed = traceActive && !inTrace(nd.id);
        const highlighted = traceActive && inTrace(nd.id);
        const taxonomyLabel = nd.depth < 4 && (nd.size >= INSIDE_LABEL_SIZE || expanded.has(nd.id));
        const showLabel =
          taxonomyLabel || highlighted || nd.id === selectedId || nd.id === hoverId;
        return (
          <NodeItem
            key={nd.id}
            nd={nd}
            color={colorOf(nd.id)}
            dimmed={dimmed}
            highlighted={highlighted}
            selected={nd.id === selectedId}
            showLabel={showLabel}
            geometry={sphereGeo}
            register={register}
            onClickNode={clickNode}
            onHoverNode={hoverNode}
          />
        );
      })}

      <OrbitControls
        ref={controlsRef}
        makeDefault
        enableDamping
        dampingFactor={0.08}
        rotateSpeed={0.55}
        panSpeed={1.1}
        screenSpacePanning
        minDistance={120}
        maxDistance={4200}
        onStart={() => (desired.current.active = false)}
      />
    </>
  );
}

export default function MathMap3D(props: Props) {
  // The WebGL context can be lost (GPU process restart, embedded webviews,
  // waking from sleep) — sometimes even during the very first frame, which
  // silently kills the render loop and leaves a white canvas. Remount the
  // whole Canvas when that happens; map state lives in the parent, so only
  // the camera resets.
  const [glKey, setGlKey] = useState(0);
  // Rotating/panning starts and ends on empty space, which R3F reports as a
  // "missed" click — only clear the selection for a genuine stationary
  // left-click (no drag, no Shift/⌘/Ctrl/right-button pan).
  const pointerDown = useRef<{ x: number; y: number } | null>(null);
  return (
    <div
      className="absolute inset-0"
      onPointerDown={(e) => (pointerDown.current = { x: e.clientX, y: e.clientY })}
    >
      <Canvas
        key={glKey}
        camera={{ position: [0, -420, 1400], fov: 55, near: 1, far: 12000 }}
        dpr={[1, 2]}
        onPointerMissed={(e) => {
          const d = pointerDown.current;
          const moved = d ? Math.hypot(e.clientX - d.x, e.clientY - d.y) : 0;
          if (e.button === 0 && !e.shiftKey && !e.metaKey && !e.ctrlKey && moved < 6)
            props.onSelect(null);
        }}
        onCreated={({ gl }) => {
          gl.domElement.addEventListener("webglcontextlost", (e) => {
            e.preventDefault();
            setTimeout(() => setGlKey((k) => k + 1), 200);
          });
        }}
      >
        <color attach="background" args={["#0b1220"]} />
        <fog attach="fog" args={["#0b1220", 2600, 7000]} />
        <ambientLight intensity={0.85} />
        <directionalLight position={[600, 900, 1200]} intensity={1.1} />
        <directionalLight position={[-800, -400, -900]} intensity={0.35} color="#7dd3fc" />
        <Stars radius={3200} depth={900} count={2600} factor={5} saturation={0.4} fade speed={0.35} />
        <Scene {...props} />
      </Canvas>
    </div>
  );
}
