// Top-down track map with the racing line coloured by speed, inputs or g.

import type { Lap, Track } from "./data";
import { color, mix } from "./theme/theme";
import { esc } from "./format";

export type MapMode = "speed" | "inputs" | "g";

const BINS = 8;

/** Colour classes for a mode: index -> CSS colour. Built from theme roles only. */
export function palette(mode: MapMode): string[] {
  if (mode === "speed") return Array.from({ length: BINS }, (_, i) => mix("series-1", "series-2", i / (BINS - 1)));
  // hard brake .. coast .. full throttle (inputs) or hard braking .. steady .. hard drive (g)
  return [
    color("brake"), mix("brake", "text-muted", 0.35), mix("brake", "text-muted", 0.7),
    color("text-muted"), mix("throttle", "text-muted", 0.5), color("throttle"),
  ];
}

export const LEGEND: Record<Exclude<MapMode, "speed">, string[]> = {
  inputs: ["Hard brake", "Braking", "Light brake", "Coasting", "Part throttle", "Full throttle"],
  g: ["Hard braking", "Braking", "Slowing", "Steady", "Accelerating", "Hard drive"],
};

function inputBin(thr: number, brk: number, rear: number): number {
  if (brk > 0.6) return 0;
  if (brk > 0.2) return 1;
  if (brk > 0.05 || rear > 0.5) return 2;
  if (thr > 0.95) return 5;
  return thr > 0.05 ? 4 : 3;
}

const G_EDGES = [-0.6, -0.25, -0.08, 0.08, 0.3];
const gBin = (g: number) => { let i = 0; while (i < G_EDGES.length && g > G_EDGES[i]) i++; return i; };

function racingLine(lap: Lap, mode: MapMode): string {
  const { x, y, v, ax, thr, brk, rear } = lap.trace;
  const lo = Math.min(...v), hi = Math.max(...v);
  const bin = mode === "inputs" && thr && brk && rear ? (i: number) => inputBin(thr[i], brk[i], rear[i])
    : mode === "g" ? (i: number) => gBin((ax[i] + ax[i + 1]) / 2)
    : (i: number) => Math.min(BINS - 1, Math.floor((((v[i] + v[i + 1]) / 2 - lo) / (hi - lo || 1)) * BINS));
  const pal = palette(mode);
  let out = "", run: string[] = [], cur = -1;
  const flush = () => { if (run.length > 1) out += `<polyline class="lap-line" stroke="${pal[cur]}" points="${run.join(" ")}"/>`; };
  for (let i = 0; i < x.length - 1; i++) {
    const b = bin(i);
    if (b !== cur && run.length) { flush(); run = [run[run.length - 1]]; }
    cur = b;
    if (!run.length) run.push(`${x[i]},${y[i]}`);
    run.push(`${x[i + 1]},${y[i + 1]}`);
  }
  flush();
  return `<g>${out}</g>`;
}

export function mapSVG(t: Track, lap: Lap | null, mode: MapMode): string {
  const pts = t.left.concat(t.right);
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const pad = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) * 0.04;
  const x0 = Math.min(...xs) - pad, y0 = Math.min(...ys) - pad;
  const w = Math.max(...xs) - x0 + pad, h = Math.max(...ys) - y0 + pad;
  const P = (a: number[][]) => a.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  // start/finish bar across the road, sized to the map rather than the real road width
  const [l0, r0, c0] = [t.left[0], t.right[0], t.centre[0]];
  const nl = Math.hypot(r0[0] - l0[0], r0[1] - l0[1]) || 1, half = Math.max(w, h) / 55;
  const [ux, uy] = [((r0[0] - l0[0]) / nl) * half, ((r0[1] - l0[1]) / nl) * half];
  const sw = (Math.max(w, h) / 160).toFixed(1);
  return `<svg class="map" viewBox="${x0} ${y0} ${w} ${h}" role="img" aria-label="Map of ${esc(t.venue)} layout ${esc(t.layout)}"
      style="--road-w:${(Math.max(w, h) / 70).toFixed(1)}px;--line-w:${sw}px">
    <polygon class="road-edge" points="${P(t.centre)}"/>
    <polygon class="road" points="${P(t.centre)}"/>
    <line class="sf" x1="${c0[0] - ux}" y1="${c0[1] - uy}" x2="${c0[0] + ux}" y2="${c0[1] + uy}"/>
    ${lap ? racingLine(lap, mode) : ""}
    <circle class="cursor" r="${(Math.max(w, h) / 90).toFixed(1)}" cx="0" cy="0" visibility="hidden"/>
  </svg>`;
}

export function moveMapDot(p: [number, number] | null) {
  const dot = document.querySelector<SVGCircleElement>(".map .cursor");
  if (!dot) return;
  if (!p) return void dot.setAttribute("visibility", "hidden");
  dot.setAttribute("cx", String(p[0]));
  dot.setAttribute("cy", String(p[1]));
  dot.setAttribute("visibility", "visible");
}

/** Hovering the map reports the lap distance of the nearest racing-line point. */
export function wireMap(svg: SVGSVGElement, lap: Lap, onDistance: (d: number | null, e: PointerEvent) => void) {
  const { x, y, d } = lap.trace;
  svg.addEventListener("pointermove", (e) => {
    const ctm = svg.getScreenCTM();
    if (!ctm) return;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    let bi = 0, bd = Infinity;
    for (let i = 0; i < x.length; i++) {
      const dd = (x[i] - p.x) ** 2 + (y[i] - p.y) ** 2;
      if (dd < bd) { bd = dd; bi = i; }
    }
    const vb = svg.viewBox.baseVal;
    onDistance(Math.sqrt(bd) > Math.max(vb.width, vb.height) * 0.06 ? null : d[bi], e);
  });
  svg.addEventListener("pointerleave", (e) => onDistance(null, e));
}
