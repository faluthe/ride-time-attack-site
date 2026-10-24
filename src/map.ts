// Top-down track map: each lap's racing line in its own colour, shaded by what the rider is doing
// (or by speed), rider markers for scrubbing and playback, and zoom/pan to study lines closely.

import type { Lap, Trace, Track } from "./data";
import { at, near } from "./data";
import { color, mix } from "./theme/theme";
import { esc } from "./format";

export type MapMode = "inputs" | "speed";

/** Most laps shown at once: the lap plus three to compare, one series colour each. */
export const MAX_LAPS = 4;
/** Colour role of the `i`th lap shown (0 = the lap, then the compare laps). */
export const lapRole = (i: number) => `series-${i + 1}`;

/** Input class of a sample: 0-2 braking (hard to light), 3 coasting, 4-5 throttle (part, full). */
export function inputBin(thr: number, brk: number, rear: number): number {
  if (brk > 0.6) return 0;
  if (brk > 0.2) return 1;
  if (brk > 0.05 || rear > 0.5) return 2;
  if (thr > 0.95) return 5;
  return thr > 0.05 ? 4 : 3;
}

/** Throttle and brake in their own roles, hard brake .. coast .. full throttle (for the graphs). */
export function inputColours(): string[] {
  return [
    color("brake"), mix("brake", "text-muted", 0.35), mix("brake", "text-muted", 0.7),
    color("text-muted"), mix("throttle", "text-muted", 0.5), color("throttle"),
  ];
}

/**
 * Inputs shading: every lap keeps its own colour on the throttle and blends towards the brake
 * colour the harder it brakes, greying a little while coasting. Per input class (see `inputBin`):
 * [role to blend towards, how far].
 */
const INPUT_BLEND: [string, number][] = [
  ["brake", 0.85], ["brake", 0.65], ["brake", 0.45], ["text-muted", 0.45], ["text-muted", 0.15], ["text-muted", 0],
];
/** Speed shading: the slowest eighth of the lap fades most towards the background. */
const SPEED_BINS = 8, SPEED_FADE = 0.7;

/** The `i`th lap's colour for each shading class of `mode`. */
function shades(i: number, mode: MapMode): string[] {
  const role = lapRole(i);
  if (mode === "inputs") return INPUT_BLEND.map(([to, f]) => (f ? mix(role, to, f) : color(role)));
  return Array.from({ length: SPEED_BINS }, (_, b) => {
    const f = SPEED_FADE * (1 - b / (SPEED_BINS - 1));
    return f ? mix(role, "bg", f) : color(role);
  });
}

/** A lap's shading class at a lap distance (`at`, interpolated) or at a sample (`sample`). */
function classer(t: Trace, mode: MapMode): { at: (d: number) => number; sample: (j: number) => number } {
  const { thr, brk, rear, v } = t;
  if (mode === "inputs" && thr && brk) {
    return {
      at: (d) => inputBin(at(t, thr, d), at(t, brk, d), rear ? near(t, rear, d) : 0),
      sample: (j) => inputBin(thr[j], brk[j], rear ? rear[j] : 0),
    };
  }
  const lo = Math.min(...v), hi = Math.max(...v);
  const bin = (s: number) => Math.min(SPEED_BINS - 1, Math.floor(((s - lo) / (hi - lo || 1)) * SPEED_BINS));
  return { at: (d) => bin(at(t, v, d)), sample: (j) => bin(v[j]) };
}

/** A lap's shading mode: speed when it has no throttle and brake. */
const modeOf = (t: Trace, mode: MapMode): MapMode => (mode === "inputs" && t.thr && t.brk ? "inputs" : "speed");

/** The colour the `i`th lap's marker takes at lap distance `d`, matching its line there. */
export function markerColour(t: Trace, i: number, mode: MapMode, d: number): string {
  const m = modeOf(t, mode);
  return shades(i, m)[classer(t, m).at(d)];
}

const pts = (xs: number[], ys: number[], from = 0, to = xs.length) => {
  let s = "";
  for (let i = from; i < to; i++) s += `${xs[i]},${ys[i]} `;
  return s;
};

/** A lap's line in its plain colour, for comparing (its inputs show as `inputPoints` instead). */
const plainLine = (lap: Lap, i: number) =>
  `<polyline class="${i ? "cmp-line" : "lap-line"}" stroke="${color(lapRole(i))}" points="${pts(lap.trace.x, lap.trace.y)}"/>`;

/** Off the brakes this long (s) before braking again counts as a new braking point. */
const REBRAKE = 0.5;

/**
 * Where a lap starts braking, and where it picks the throttle back up after: red and green dots
 * ringed in the lap's colour. Dots are zero-length round-capped lines, so they keep their size on
 * screen at any zoom.
 */
function inputPoints(lap: Lap, i: number): string {
  const { t, x, y, thr, brk } = lap.trace;
  if (!thr || !brk) return "";
  const dot = (j: number, role: string) => `<line class="pt-ring" stroke="${color(lapRole(i))}" x1="${x[j]}" y1="${y[j]}" x2="${x[j]}" y2="${y[j]}"/>
    <line class="pt" stroke="${color(role)}" x1="${x[j]}" y1="${y[j]}" x2="${x[j]}" y2="${y[j]}"/>`;
  let out = "", lastBrake = -Infinity, waiting = false;
  for (let j = 0; j < t.length; j++) {
    if (brk[j] > 0.1) {
      if (t[j] - lastBrake > REBRAKE) { out += dot(j, "brake"); waiting = true; }
      lastBrake = t[j];
    } else if (waiting && thr[j] > 0.1 && brk[j] < 0.05) {
      out += dot(j, "throttle");
      waiting = false;
    }
  }
  return out;
}

/** The `i`th lap's line split into runs of one shade. */
function racingLine(lap: Lap, i: number, mode: MapMode): string {
  const m = modeOf(lap.trace, mode), pal = shades(i, m), shadeAt = classer(lap.trace, m).sample;
  const { x, y } = lap.trace, cls = i ? "cmp-line" : "lap-line";
  let out = "", start = 0, cur = shadeAt(0);
  for (let j = 1; j < x.length - 1; j++) {
    const c = shadeAt(j);
    if (c === cur) continue;
    out += `<polyline class="${cls}" stroke="${pal[cur]}" points="${pts(x, y, start, j + 1)}"/>`;
    start = j;
    cur = c;
  }
  return out + `<polyline class="${cls}" stroke="${pal[cur]}" points="${pts(x, y, start)}"/>`;
}


/** Arrow pointing along +x, about 16 px long once scaled to screen pixels (see `MapView`). */
const ARROW = "M8,0 L-6,-6 L-3,0 L-6,6 Z";

/**
 * The map. `laps[0]` is the lap being studied, the rest compare laps; each is drawn in its own
 * colour, shaded by `mode`. One marker per lap, hidden until placed.
 */
export function mapSVG(t: Track, laps: Lap[], mode: MapMode): string {
  const pts2 = t.left.concat(t.right);
  const xs = pts2.map((p) => p[0]), ys = pts2.map((p) => p[1]);
  const pad = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) * 0.04;
  const x0 = Math.min(...xs) - pad, y0 = Math.min(...ys) - pad;
  const w = Math.max(...xs) - x0 + pad, h = Math.max(...ys) - y0 + pad;
  const P = (a: number[][]) => a.map((p) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`).join(" ");
  const edge = (a: number[][]) => `M${P(a)}Z`;
  // the start line where the lap starts: the game times laps from its own line, not the spline start
  const s = laps[0] ? nearestIndex(t.centre, laps[0].trace.x[0], laps[0].trace.y[0]) : 0;
  const [l0, r0] = [t.left[s], t.right[s]];
  // one lap: shaded by its inputs. Comparing: plain lines, with each lap's braking and throttle points
  const cmp = laps.length > 1;
  const lines = laps.map((l, i) => (cmp ? plainLine(l, i) : racingLine(l, i, mode)));
  const points = cmp && mode === "inputs" ? laps.map((l, i) => inputPoints(l, i)).reverse().join("") : "";
  // compare laps underneath, the studied lap on top
  const lineSVG = lines.slice(1).reverse().join("") + (lines[0] ?? "");
  const markers = laps.map((_, i) => `<g class="marker" data-i="${i}" visibility="hidden">
    <path d="${ARROW}" fill="${color(lapRole(i))}"/></g>`).reverse().join("");
  return `<svg class="map" viewBox="${x0} ${y0} ${w} ${h}" role="img" aria-label="Map of ${esc(t.venue)} layout ${esc(t.layout)}"
      data-fit="${x0} ${y0} ${w} ${h}">
    <polygon class="road-band" points="${P(t.centre)}"/>
    <path class="road" fill-rule="evenodd" d="${edge(t.left)} ${edge(t.right)}"/>
    <path class="road-edge" d="${edge(t.left)} ${edge(t.right)}"/>
    <line class="sf" x1="${l0[0]}" y1="${l0[1]}" x2="${r0[0]}" y2="${r0[1]}"/>
    <g class="lines">${lineSVG}</g>
    <g class="points">${points}</g>
    <g class="markers">${markers}</g>
  </svg>`;
}

function nearestIndex(pts: number[][], x: number, y: number): number {
  let bi = 0, bd = Infinity;
  pts.forEach((p, i) => { const d = (p[0] - x) ** 2 + (p[1] - y) ** 2; if (d < bd) { bd = d; bi = i; } });
  return bi;
}

/** Where a rider is, and the marker's colour (its line's colour there). */
export interface MarkerPos { x: number; y: number; hdg: number; fill: string }

export interface Box { x: number; y: number; w: number; h: number }

/**
 * Zoom, pan and pointer handling for a map from `mapSVG`. The wheel or a pinch zooms, dragging
 * pans, hovering previews the nearest point of the lap's line and a click (or tap) picks it.
 */
export class MapView {
  private box: Box;
  private readonly fit: Box;
  private markers: (MarkerPos | null)[] = [];
  /** Keep the first marker in the middle while zoomed in. */
  follow = false;
  onZoom?: () => void;

  constructor(private svg: SVGSVGElement, private lap: Lap | null,
    private hooks: { hover: (d: number | null) => void; pick: (d: number) => void }) {
    const [x, y, w, h] = svg.dataset.fit!.split(" ").map(Number);
    this.fit = { x, y, w, h };
    this.box = { ...this.fit };
    this.wire();
    this.apply();
  }

  /** How far in we are: 1 = the whole layout. */
  get zoom() { return this.fit.w / this.box.w; }

  /** Restore a zoom/pan from an earlier view of the same layout (re-renders keep the view). */
  restore(b: Box | null) { if (b) { this.box = { ...b }; this.apply(); } }
  get view(): Box { return { ...this.box }; }

  zoomBy(f: number, cx = this.box.x + this.box.w / 2, cy = this.box.y + this.box.h / 2) {
    const w = Math.min(this.fit.w, Math.max(this.fit.w / 120, this.box.w / f));
    const k = w / this.box.w, h = this.box.h * k;
    this.box = { x: cx - (cx - this.box.x) * k, y: cy - (cy - this.box.y) * k, w, h };
    if (this.zoom <= 1.001) this.box = { ...this.fit };
    this.apply();
  }

  reset() { this.box = { ...this.fit }; this.apply(); }

  /** Zoom to `zoom` (1 = whole layout) centred on a point. */
  centre(x: number, y: number, zoom = this.zoom) {
    const w = Math.min(this.fit.w, Math.max(this.fit.w / 120, this.fit.w / zoom)), h = this.fit.h * (w / this.fit.w);
    this.box = { x: x - w / 2, y: y - h / 2, w, h };
    this.apply();
  }

  /** Place the markers (in `mapSVG`'s lap order); `null` hides one. */
  setMarkers(ms: (MarkerPos | null)[]) {
    this.markers = ms;
    const m = ms[0];
    if (this.follow && m && this.zoom > 1.05) {
      this.box.x = m.x - this.box.w / 2;
      this.box.y = m.y - this.box.h / 2;
      this.apply();
    } else this.drawMarkers();
  }

  /** Map units per screen pixel. */
  private unit() {
    const r = this.svg.getBoundingClientRect();
    // the viewBox is fitted inside the element ("meet"), so the tighter axis sets the scale
    return Math.max(this.box.w / (r.width || 1), this.box.h / (r.height || 1));
  }

  private apply() {
    const b = this.box;
    this.svg.setAttribute("viewBox", `${b.x} ${b.y} ${b.w} ${b.h}`);
    this.svg.classList.toggle("zoomed", this.zoom > 1.001);
    // once the road drawn to scale is wider than the schematic band (~9 px), the band only misleads
    this.svg.classList.toggle("to-scale", this.unit() < 1.5);
    this.drawMarkers();
    this.onZoom?.();
  }

  private drawMarkers() {
    const u = this.unit();
    this.svg.querySelectorAll<SVGGElement>(".marker").forEach((g) => {
      const m = this.markers[Number(g.dataset.i)];
      if (!m) return void g.setAttribute("visibility", "hidden");
      g.setAttribute("transform", `translate(${m.x} ${m.y}) rotate(${m.hdg}) scale(${u})`);
      g.querySelector("path")!.setAttribute("fill", m.fill);
      g.setAttribute("visibility", "visible");
    });
  }

  private toMap(e: { clientX: number; clientY: number }): DOMPoint | null {
    const ctm = this.svg.getScreenCTM();
    return ctm ? new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse()) : null;
  }

  /** Lap distance of the line point nearest `p`, or null if the pointer is well off the line. */
  private nearest(p: DOMPoint | null): number | null {
    if (!p || !this.lap) return null;
    const { x, y, d } = this.lap.trace;
    let bi = 0, bd = Infinity;
    for (let i = 0; i < x.length; i++) {
      const dd = (x[i] - p.x) ** 2 + (y[i] - p.y) ** 2;
      if (dd < bd) { bd = dd; bi = i; }
    }
    return Math.sqrt(bd) > 40 * this.unit() ? null : d[bi];
  }

  private wire() {
    const svg = this.svg;
    const down = new Map<number, { x: number; y: number }>();
    let dragged = false, pinch = 0;
    svg.addEventListener("wheel", (e) => {
      e.preventDefault();
      const p = this.toMap(e);
      this.zoomBy(Math.exp(-e.deltaY * (e.deltaMode ? 0.05 : 0.0015)), p?.x, p?.y);
    }, { passive: false });
    svg.addEventListener("pointerdown", (e) => {
      svg.setPointerCapture(e.pointerId);
      down.set(e.pointerId, { x: e.clientX, y: e.clientY });
      dragged = false;
      if (down.size === 2) {
        const [a, b] = [...down.values()];
        pinch = Math.hypot(a.x - b.x, a.y - b.y);
      }
    });
    svg.addEventListener("pointermove", (e) => {
      const last = down.get(e.pointerId);
      if (!last) {
        if (e.pointerType === "mouse") this.hooks.hover(this.nearest(this.toMap(e)));
        return;
      }
      if (down.size === 2) {
        down.set(e.pointerId, { x: e.clientX, y: e.clientY });
        const [a, b] = [...down.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        const mid = this.toMap({ clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2 });
        if (pinch) this.zoomBy(dist / pinch, mid?.x, mid?.y);
        pinch = dist;
        dragged = true;
        return;
      }
      const dx = e.clientX - last.x, dy = e.clientY - last.y;
      if (!dragged && Math.hypot(dx, dy) < 4) return;
      dragged = true;
      down.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.zoom > 1.001) {
        const u = this.unit();
        this.box.x -= dx * u;
        this.box.y -= dy * u;
        this.apply();
      }
    });
    const up = (e: PointerEvent) => {
      if (!down.delete(e.pointerId)) return;
      if (!dragged && !down.size) {
        const d = this.nearest(this.toMap(e));
        if (d != null) this.hooks.pick(d);
      }
      if (down.size < 2) pinch = 0;
    };
    svg.addEventListener("pointerup", up);
    svg.addEventListener("pointercancel", (e) => { down.delete(e.pointerId); pinch = 0; });
    svg.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse" && !down.size) this.hooks.hover(null); });
  }
}
