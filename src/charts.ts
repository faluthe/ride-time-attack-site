// Distance-based SVG line charts that share one scrub cursor.

import { at, type Lap } from "./data";
import { color } from "./theme/theme";

export interface Series {
  xs: number[];
  ys: number[];
  role: string;
  /** which lap: 0 = the lap (solid), 1.. = compare laps, each with its own dash pattern */
  dash?: number;
  /** hold each value until the next sample (gear) */
  step?: boolean;
}

/** Dash pattern of the `i`th lap shown; the lap itself is solid. */
export const DASHES = ["", "6 4", "2 3", "10 3 2 3"];

export interface ChartSpec {
  id: string;
  title: string;
  unit?: string;
  /** pixels, unless drawn into a `.fill` element with a height of its own (a resized graph) */
  height: number;
  /** fixed y range; otherwise fitted (and symmetric if `zero`) */
  range?: [number, number];
  zero?: boolean;
  ticks?: number[];
  tickLabel?: (v: number) => string;
  series: (lap: Lap, cmps: Lap[]) => Series[];
  /** extra marks on the plot, e.g. rear brake presses (`y` is the bottom of the plot) */
  marks?: (lap: Lap, X: (d: number) => number, y: number, cmps: Lap[], Y: (v: number) => number) => string;
}

/** How the charts report the pointer: hovering previews, pressing (and dragging) picks. */
export interface CursorHooks {
  hover: (d: number | null) => void;
  pick: (d: number) => void;
}

function niceTicks(lo: number, hi: number, n = 4): number[] {
  const step0 = (hi - lo) / n, mag = 10 ** Math.floor(Math.log10(step0 || 1));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0) ?? mag * 10;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(6));
  return out;
}

/**
 * Polyline points, at most a few per pixel column: traces carry every frame (~7000 a lap), far
 * more than the chart is wide, so each column keeps its first, lowest, highest and last point.
 */
function points(s: Series, X: (d: number) => number, Y: (v: number) => number): string {
  const out: string[] = [];
  const put = (x: number, v: number) => out.push(`${x.toFixed(1)},${Y(v).toFixed(1)}`);
  let col = NaN, lo = 0, hi = 0, last = 0;
  const flush = () => {
    if (lo !== hi) { put(col, s.ys[lo < hi ? lo : hi]); put(col, s.ys[lo < hi ? hi : lo]); }
    put(col, s.ys[last]);
  };
  for (let i = 0; i < s.xs.length; i++) {
    const x = X(s.xs[i]), c = Math.round(x);
    if (c !== col) {
      if (!isNaN(col)) flush();
      if (s.step && i) put(x, s.ys[i - 1]);
      put(x, s.ys[i]);
      col = c; lo = hi = last = i;
      continue;
    }
    if (s.ys[i] < s.ys[lo]) lo = i;
    if (s.ys[i] > s.ys[hi]) hi = i;
    last = i;
  }
  if (!isNaN(col)) flush();
  return out.join(" ");
}

interface Geo { X: (d: number) => number; Y: (v: number) => number; series: Series[] }
const geos = new WeakMap<HTMLElement, Geo>();

export function drawChart(el: HTMLElement, spec: ChartSpec, lap: Lap, cmps: Lap[], length: number, hooks: CursorHooks) {
  // a resized graph sets the height its first chart fills (empty first, so the old svg can't prop it up)
  if (el.classList.contains("fill")) el.innerHTML = "";
  const fillH = el.classList.contains("fill") ? el.clientHeight : 0;
  const series = spec.series(lap, cmps);
  const W = el.clientWidth, H = fillH > 40 ? fillH : spec.height, ml = 44, mr = 10, mt = 8, mb = 22;
  const all = series.flatMap((s) => s.ys);
  let lo = Math.min(...all), hi = Math.max(...all);
  if (spec.range) { lo = spec.range[0]; hi = Math.max(spec.range[1], hi); }
  else if (spec.zero) { const m = Math.max(Math.abs(lo), Math.abs(hi)) || 1; lo = -m; hi = m; }
  else { lo = Math.max(0, lo - 10); hi += 10; }
  const X = (d: number) => ml + (d / length) * (W - ml - mr);
  const Y = (v: number) => mt + (1 - (v - lo) / (hi - lo || 1)) * (H - mt - mb);
  const yt = spec.ticks ?? niceTicks(lo, hi);
  const xt = niceTicks(0, length / 1000, Math.max(2, Math.floor(W / 120)));
  const label = spec.tickLabel ?? String;
  let g = yt.map((v) => `<line class="grid" x1="${ml}" x2="${W - mr}" y1="${Y(v)}" y2="${Y(v)}"/>
    <text class="tick" x="${ml - 6}" y="${Y(v) + 4}" text-anchor="end">${label(v)}</text>`).join("");
  g += xt.map((k) => `<text class="tick" x="${X(k * 1000)}" y="${H - 6}" text-anchor="middle">${k} km</text>`).join("");
  if (spec.zero) g += `<line class="axis" x1="${ml}" x2="${W - mr}" y1="${Y(0)}" y2="${Y(0)}"/>`;
  // compare laps underneath
  const order = series.map((_, i) => i).sort((a, b) => (series[b].dash ?? 0) - (series[a].dash ?? 0));
  const lines = order.map((i) => {
    const s = series[i], dash = DASHES[s.dash ?? 0];
    return `<polyline class="series${dash ? " dash" : ""}" stroke="${color(s.role)}"${dash ? ` stroke-dasharray="${dash}"` : ""} points="${points(s, X, Y)}"/>`;
  }).join("");
  const marks = spec.marks?.(lap, X, H - mb, cmps, Y) ?? "";
  el.innerHTML = `<svg width="${W}" height="${H}" role="img" aria-label="${spec.title} by lap distance">${g}${lines}${marks}
    <line class="xhair" y1="${mt}" y2="${H - mb}" visibility="hidden"/>
    ${series.map((s) => `<circle class="xdot" r="${s.dash ? 3 : 4}" fill="${color(s.role)}" visibility="hidden"/>`).join("")}
    <rect class="hit" x="${ml}" y="0" width="${W - ml - mr}" height="${H}" fill="transparent"/></svg>`;
  geos.set(el, { X, Y, series });
  const hit = el.querySelector<SVGRectElement>(".hit")!;
  const dAt = (e: PointerEvent) => {
    const r = hit.getBoundingClientRect();
    return Math.min(length, Math.max(0, ((e.clientX - r.left) / r.width) * length));
  };
  hit.addEventListener("pointerdown", (e) => { hit.setPointerCapture(e.pointerId); hooks.pick(dAt(e)); });
  hit.addEventListener("pointermove", (e) => {
    if (hit.hasPointerCapture(e.pointerId)) hooks.pick(dAt(e));
    else if (e.pointerType === "mouse") hooks.hover(dAt(e));
  });
  hit.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") hooks.hover(null); });
}

/** Move every chart's crosshair to lap distance `d` (or hide it). */
export function setChartCursor(d: number | null) {
  document.querySelectorAll<HTMLElement>(".chart").forEach((el) => {
    const g = geos.get(el), svg = el.querySelector("svg");
    if (!g || !svg) return;
    const vis = d == null ? "hidden" : "visible";
    const xh = svg.querySelector(".xhair")!;
    xh.setAttribute("visibility", vis);
    svg.querySelectorAll(".xdot").forEach((dot) => dot.setAttribute("visibility", vis));
    if (d == null) return;
    const x = g.X(d);
    xh.setAttribute("x1", String(x));
    xh.setAttribute("x2", String(x));
    svg.querySelectorAll(".xdot").forEach((dot, i) => {
      const s = g.series[i];
      // a series can stop short of `d` (the delta chart starts at the line)
      const show = d >= s.xs[0] && d <= s.xs[s.xs.length - 1];
      dot.setAttribute("visibility", show ? "visible" : "hidden");
      dot.setAttribute("cx", String(x));
      dot.setAttribute("cy", String(g.Y(at({ d: s.xs }, s.ys, d))));
    });
  });
}
