/** Not baglanti grafigi: d3-force yerlesim + canvas cizim. Hareket bitince cizim durur (CPU harcamaz). */
import { useEffect, useMemo, useRef, useState } from "react";
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, type SimulationNodeDatum } from "d3-force";
import { isNote, title } from "../lib/paths";
import { fuzzyScore } from "../lib/fuzzy";
import { openPath, useIndex, useStore } from "../store";

type N = SimulationNodeDatum & { id: string; label: string; degree: number };
type L = { source: N | string; target: N | string };

export function GraphView({ active }: { active: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const idx = useIndex();
  const files = useStore((s) => s.files);
  const lastNote = useStore((s) => [...s.history].reverse().find((p) => isNote(p)) ?? null);
  const [local, setLocal] = useState(false);
  const [orphans, setOrphans] = useState(true);
  const [filter, setFilter] = useState("");

  const data = useMemo(() => {
    let ids = files.filter((f) => !f.dir && isNote(f.path)).map((f) => f.path);
    const edges: [string, string][] = [];
    for (const [from, outs] of idx.outgoing) for (const to of outs) if (isNote(to)) edges.push([from, to]);
    if (local && lastNote) {
      const keep = new Set([lastNote]);
      for (let depth = 0; depth < 2; depth++)
        for (const [a, b] of edges) {
          if (keep.has(a)) keep.add(b);
          else if (keep.has(b)) keep.add(a);
        }
      ids = ids.filter((id) => keep.has(id));
    }
    const set = new Set(ids);
    const links = edges.filter(([a, b]) => set.has(a) && set.has(b));
    const degree = new Map<string, number>();
    for (const [a, b] of links) {
      degree.set(a, (degree.get(a) || 0) + 1);
      degree.set(b, (degree.get(b) || 0) + 1);
    }
    const nodes: N[] = ids.filter((id) => orphans || degree.get(id)).map((id) => ({ id, label: title(id), degree: degree.get(id) || 0 }));
    const nodeSet = new Set(nodes.map((n) => n.id));
    return { nodes, links: links.filter(([a, b]) => nodeSet.has(a) && nodeSet.has(b)).map(([a, b]) => ({ source: a, target: b }) as L) };
  }, [idx, files, local, orphans, lastNote]);

  useEffect(() => {
    const cv = canvas.current;
    if (!cv || !active) return;
    const ctx = cv.getContext("2d")!;
    const style = getComputedStyle(cv);
    const color = (v: string) => style.getPropertyValue(v).trim() || "#888";
    const C = { node: color("--graph-node"), accent: color("--accent"), line: color("--graph-line"), text: color("--text"), bg: color("--bg") };
    const view = { x: 0, y: 0, k: 1 };
    let hover: N | null = null;
    let drag: N | null = null;
    let panning: { x: number; y: number; vx: number; vy: number } | null = null;
    let frame = 0;
    const query = filter.trim();
    const neighbors = new Map<string, Set<string>>();
    for (const l of data.links) {
      const a = typeof l.source === "string" ? l.source : l.source.id;
      const b = typeof l.target === "string" ? l.target : l.target.id;
      neighbors.set(a, (neighbors.get(a) || new Set()).add(b));
      neighbors.set(b, (neighbors.get(b) || new Set()).add(a));
    }
    const radius = (n: N) => 4 + Math.min(10, Math.sqrt(n.degree) * 2.2);

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      cv.width = cv.clientWidth * dpr;
      cv.height = cv.clientHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      draw();
    };

    const sim = forceSimulation<N>(data.nodes)
      .force("link", forceLink<N, L & { source: N; target: N }>(data.links as (L & { source: N; target: N })[]).id((d) => d.id).distance(70).strength(0.6))
      .force("charge", forceManyBody().strength(-160))
      .force("center", forceCenter(0, 0))
      .force("collide", forceCollide<N>().radius((n) => radius(n) + 6))
      .alphaDecay(0.035)
      .on("tick", () => request());

    function request() {
      if (!frame) frame = requestAnimationFrame(draw);
    }

    function draw() {
      frame = 0;
      const w = cv!.clientWidth;
      const h = cv!.clientHeight;
      ctx.clearRect(0, 0, w, h);
      ctx.save();
      ctx.translate(w / 2 + view.x, h / 2 + view.y);
      ctx.scale(view.k, view.k);
      const focus = hover ? neighbors.get(hover.id) : null;
      ctx.lineWidth = 1 / view.k;
      for (const l of data.links) {
        const a = l.source as N;
        const b = l.target as N;
        const lit = hover && (a === hover || b === hover);
        ctx.strokeStyle = lit ? C.accent : C.line;
        ctx.globalAlpha = hover && !lit ? 0.25 : 1;
        ctx.beginPath();
        ctx.moveTo(a.x!, a.y!);
        ctx.lineTo(b.x!, b.y!);
        ctx.stroke();
      }
      for (const n of data.nodes) {
        const match = query ? fuzzyScore(query, n.label) > 0 : false;
        const dim = (hover && n !== hover && !focus?.has(n.id)) || (query && !match);
        ctx.globalAlpha = dim ? 0.2 : 1;
        ctx.fillStyle = n === hover || match || n.id === lastNote ? C.accent : C.node;
        ctx.beginPath();
        ctx.arc(n.x!, n.y!, radius(n), 0, Math.PI * 2);
        ctx.fill();
        if (view.k > 0.75 || n === hover || focus?.has(n.id) || match) {
          ctx.fillStyle = C.text;
          ctx.font = `${12 / Math.max(view.k, 0.75)}px "Segoe UI Variable Text", "Segoe UI", sans-serif`;
          ctx.textAlign = "center";
          ctx.fillText(n.label.length > 32 ? `${n.label.slice(0, 30)}…` : n.label, n.x!, n.y! + radius(n) + 13 / Math.max(view.k, 0.75));
        }
      }
      ctx.restore();
      ctx.globalAlpha = 1;
    }

    const toWorld = (e: { offsetX: number; offsetY: number }) => ({
      x: (e.offsetX - cv.clientWidth / 2 - view.x) / view.k,
      y: (e.offsetY - cv.clientHeight / 2 - view.y) / view.k,
    });
    const pick = (e: { offsetX: number; offsetY: number }) => {
      const p = toWorld(e);
      let best: N | null = null;
      let bestD = Infinity;
      for (const n of data.nodes) {
        const d = Math.hypot(n.x! - p.x, n.y! - p.y);
        if (d < radius(n) + 4 && d < bestD) {
          best = n;
          bestD = d;
        }
      }
      return best;
    };

    let moved = false;
    const down = (e: PointerEvent) => {
      cv.setPointerCapture(e.pointerId);
      moved = false;
      drag = pick(e);
      if (drag) {
        drag.fx = drag.x;
        drag.fy = drag.y;
        sim.alphaTarget(0.25).restart();
      } else panning = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
    };
    const move = (e: PointerEvent) => {
      if (drag) {
        moved = true;
        const p = toWorld(e);
        drag.fx = p.x;
        drag.fy = p.y;
      } else if (panning) {
        moved = true;
        view.x = panning.vx + e.clientX - panning.x;
        view.y = panning.vy + e.clientY - panning.y;
        request();
      } else {
        const h = pick(e);
        if (h !== hover) {
          hover = h;
          cv.style.cursor = h ? "pointer" : "grab";
          request();
        }
      }
    };
    const up = (e: PointerEvent) => {
      if (drag) {
        if (!moved) void openPath(drag.id, { newTab: e.ctrlKey });
        drag.fx = null;
        drag.fy = null;
        sim.alphaTarget(0);
      }
      drag = null;
      panning = null;
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const k = Math.min(4, Math.max(0.15, view.k * Math.exp(-e.deltaY * 0.0015)));
      const mx = e.offsetX - cv.clientWidth / 2;
      const my = e.offsetY - cv.clientHeight / 2;
      view.x = mx - ((mx - view.x) * k) / view.k;
      view.y = my - ((my - view.y) * k) / view.k;
      view.k = k;
      request();
    };

    const ro = new ResizeObserver(resize);
    ro.observe(cv);
    cv.addEventListener("pointerdown", down);
    cv.addEventListener("pointermove", move);
    cv.addEventListener("pointerup", up);
    cv.addEventListener("wheel", wheel, { passive: false });
    return () => {
      sim.stop();
      ro.disconnect();
      cancelAnimationFrame(frame);
      cv.removeEventListener("pointerdown", down);
      cv.removeEventListener("pointermove", move);
      cv.removeEventListener("pointerup", up);
      cv.removeEventListener("wheel", wheel);
    };
  }, [data, active, filter, lastNote]);

  return (
    <div className="graph-view">
      <div className="graph-toolbar">
        <input className="text-input small" placeholder="Grafikte vurgula…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <label className="chip"><input type="checkbox" checked={local} onChange={(e) => setLocal(e.target.checked)} /> Yerel (son not)</label>
        <label className="chip"><input type="checkbox" checked={orphans} onChange={(e) => setOrphans(e.target.checked)} /> Bağlantısız notlar</label>
        <span className="graph-stats">{data.nodes.length} not · {data.links.length} bağlantı</span>
      </div>
      <canvas ref={canvas} className="graph-canvas" />
    </div>
  );
}
