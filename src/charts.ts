// Distance-based SVG line charts that share one hover cursor.

import { at, type Lap } from "./data";
import { color } from "./theme/theme";

export interface Series {
  xs: number[];
  ys: number[];
  role: string;
  dash?: boolean;
  /** hold each value until the next sample (gear) */
  step?: boolean;
}

export interface ChartSpec {
  id: string;
  title: string;
  unit?: string;
  height: number;
  /** fixed y range; otherwise fitted (and symmetric if `zero`) */
  range?: [number, number];
  zero?: boolean;
  ticks?: number[];
  tickLabel?: (v: number) => string;
  series: (lap: Lap, cmp: Lap | null) => Series[];
  /** extra marks under the plot, e.g. rear brake presses */
  marks?: (lap: Lap, X: (d: number) => number, y: number) => string;
}

function niceTicks(lo: number, hi: number, n = 4): number[] {
  const step0 = (hi - lo) / n, mag = 10 ** Math.floor(Math.log10(step0 || 1));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0) ?? mag * 10;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(6));
  return out;
}

interface Geo { X: (d: number) => number; Y: (v: number) => number; series: Series[] }
const geos = new WeakMap<HTMLElement, Geo>();

export function drawChart(el: HTMLElement, spec: ChartSpec, lap: Lap, cmp: Lap | null, length: number,
  onCursor: (d: number | null, e: PointerEvent) => void) {
  const series = spec.series(lap, cmp);
  const W = el.clientWidth, H = spec.height, ml = 44, mr = 10, mt = 8, mb = 22;
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
  const pts = (s: Series) => s.xs.map((d, i) =>
    (s.step && i ? `${X(d).toFixed(1)},${Y(s.ys[i - 1]).toFixed(1)} ` : "") + `${X(d).toFixed(1)},${Y(s.ys[i]).toFixed(1)}`).join(" ");
  const lines = series.map((s) => `<polyline class="series${s.dash ? " dash" : ""}" stroke="${color(s.role)}" points="${pts(s)}"/>`).join("");
  const marks = spec.marks?.(lap, X, H - mb) ?? "";
  el.innerHTML = `<svg width="${W}" height="${H}" role="img" aria-label="${spec.title} by lap distance">${g}${lines}${marks}
    <line class="xhair" y1="${mt}" y2="${H - mb}" visibility="hidden"/>
    ${series.map((s) => `<circle class="xdot" r="4" fill="${color(s.role)}" visibility="hidden"/>`).join("")}
    <rect class="hit" x="${ml}" y="0" width="${W - ml - mr}" height="${H}" fill="transparent"/></svg>`;
  geos.set(el, { X, Y, series });
  const hit = el.querySelector<SVGRectElement>(".hit")!;
  hit.addEventListener("pointermove", (e) => {
    const r = el.getBoundingClientRect();
    onCursor(((e.clientX - r.left - ml) / (W - ml - mr)) * length, e);
  });
  hit.addEventListener("pointerleave", (e) => onCursor(null, e));
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
      dot.setAttribute("cx", String(x));
      dot.setAttribute("cy", String(g.Y(at({ d: s.xs }, s.ys, d))));
    });
  });
}
