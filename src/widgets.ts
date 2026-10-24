// Widgets floating over the map: the timer, tach and rider displays, and the dragging that moves
// any widget. Colours come from theme roles (CSS classes, or `color()` for per-lap colours).

import { at, near, type Lap } from "./data";
import { color } from "./theme/theme";
import { fmtGap, fmtTime, gearName } from "./format";
import { lapRole } from "./map";
import { PANEL_LABEL, setWidgetPos, widgetPos, type Widget } from "./panels";

/** Each shown lap and its own lap distance at the cursor (the lap being studied first). */
export type At = { lap: Lap; d: number }[];

const clock = (t: number) => (t < 60 ? t.toFixed(3) : fmtTime(t));

/** The frame every widget shares: a title bar to drag it by (and hide it from), then the body. */
export function widgetFrame(w: Widget, body: string): string {
  const p = widgetPos(w);
  return `<section class="widget" data-w="${w}" style="${place(p.x, p.y)}" aria-label="${PANEL_LABEL[w]}">
    <header class="widget-head"><span>${PANEL_LABEL[w]}</span>
      <button type="button" class="widget-x" data-hide="${w}" aria-label="Hide ${PANEL_LABEL[w].toLowerCase()}">×</button></header>
    <div class="widget-body" id="w-${w}">${body}</div></section>`;
}

/** Position as a share of the free space: `left: x%` of the layer, pulled back by `x%` of the
 * widget's own width, keeps any size of widget inside the layer without measuring it. */
const place = (x: number, y: number) =>
  `left:${x * 100}%;top:${y * 100}%;transform:translate(${-x * 100}%,${-y * 100}%)`;

/** The lap clock at the cursor, and how far ahead or behind each compare lap the lap is. */
export function timerHTML(ps: At): string {
  if (!ps.length) return `<div class="timer"><div class="clock">–</div></div>`;
  const [{ lap: L, d }] = ps, tL = at(L.trace, L.trace.t, d);
  const splits = ps.slice(1).map(({ lap }, i) => {
    // the lap's time minus the compare lap's at the same distance: below zero = ahead
    const dt = tL - at(lap.trace, lap.trace.t, d);
    return `<div class="split"><i class="key" style="--c:${color(lapRole(i + 1))}"></i>vs lap ${lap.lap}
      <b class="${dt < 0 ? "ahead" : dt > 0 ? "behind" : ""}">${fmtGap(dt)}</b></div>`;
  }).join("");
  return `<div class="timer"><div class="clock">${clock(tL)}</div>
    <div class="sub">Lap ${L.lap} · ${(d / 1000).toFixed(3)} km</div>${splits}</div>`;
}

/** Point on a circle, angle in degrees clockwise from straight up. */
const polar = (cx: number, cy: number, r: number, a: number) =>
  [cx + r * Math.sin((a * Math.PI) / 180), cy - r * Math.cos((a * Math.PI) / 180)];

function arc(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const [x0, y0] = polar(cx, cy, r, a0), [x1, y1] = polar(cx, cy, r, a1);
  return `M${x0.toFixed(2)},${y0.toFixed(2)} A${r},${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1.toFixed(2)},${y1.toFixed(2)}`;
}

const SWEEP = 120, REDLINE = 0.9;

/** Engine speed (idle to limiter) on an arc, with the gear, speed and throttle / brake under it. */
export function tachHTML(ps: At): string {
  const p = ps[0];
  const t = p?.lap.trace;
  const v = (ch: number[] | undefined) => (t && ch ? at(t, ch, p.d) : 0);
  const rpm = Math.min(1, Math.max(0, v(t?.rpm))), thr = v(t?.thr), brk = v(t?.brk);
  const cx = 80, cy = 70, r = 54, a = (f: number) => -SWEEP + f * 2 * SWEEP;
  const ticks = Array.from({ length: 11 }, (_, i) => {
    const [x0, y0] = polar(cx, cy, r - 9, a(i / 10)), [x1, y1] = polar(cx, cy, r - (i % 5 ? 12 : 15), a(i / 10));
    return `<line class="tach-tick" x1="${x0}" y1="${y0}" x2="${x1}" y2="${y1}"/>`;
  }).join("");
  const bar = (cls: string, x: number, f: number) =>
    `<rect class="bar-bg" x="${x}" y="108" width="60" height="6" rx="3"/><rect class="${cls}" x="${x}" y="108" width="${60 * Math.min(1, Math.max(0, f))}" height="6" rx="3"/>`;
  return `<svg class="tach" viewBox="0 0 160 118" role="img" aria-label="Engine speed ${Math.round(rpm * 100)}%">
    <path class="tach-track" d="${arc(cx, cy, r, a(0), a(1))}"/>
    <path class="tach-red" d="${arc(cx, cy, r, a(REDLINE), a(1))}"/>
    ${rpm > 0.005 ? `<path class="tach-fill${rpm >= REDLINE ? " over" : ""}" d="${arc(cx, cy, r, a(0), a(rpm))}"/>` : ""}
    ${ticks}
    <text class="tach-gear" x="${cx}" y="${cy + 8}" text-anchor="middle">${t?.gear ? gearName(near(t, t.gear, p.d)) : "–"}</text>
    <text class="tach-speed" x="${cx}" y="${cy + 28}" text-anchor="middle">${t ? Math.round(at(t, t.v, p.d)) : "–"} km/h</text>
    ${t?.thr ? bar("bar-thr", 16, thr) : ""}${t?.brk ? bar("bar-brk", 84, brk) : ""}
  </svg>`;
}

/** The rider seen from behind, leaning with the bike; compare laps as needles on the scale. */
export function riderHTML(ps: At): string {
  const lean = (i: number) => at(ps[i].lap.trace, ps[i].lap.trace.lean, ps[i].d);
  const L = ps.length ? lean(0) : 0;
  const cx = 80, cy = 104, r = 84;
  const ticks = [-60, -45, -30, -15, 0, 15, 30, 45, 60].map((g) => {
    const [x0, y0] = polar(cx, cy, r - 4, g), [x1, y1] = polar(cx, cy, r + (g % 30 ? 2 : 5), g);
    return `<line class="scale-tick" x1="${x0}" y1="${y0}" x2="${x1}" y2="${y1}"/>`;
  }).join("");
  const needle = (g: number, i: number) => {
    const c = Math.max(-64, Math.min(64, g)), [x0, y0] = polar(cx, cy, r - 14, c), [x1, y1] = polar(cx, cy, r + 4, c);
    return `<line class="needle" stroke="${color(lapRole(i))}" x1="${x0}" y1="${y0}" x2="${x1}" y2="${y1}"/>`;
  };
  // the rider hangs off towards the inside of the turn
  const hang = (Math.max(-60, Math.min(60, L)) / 60) * 7;
  return `<svg class="rider" viewBox="0 0 160 110" role="img" aria-label="Lean ${Math.abs(L).toFixed(0)} degrees ${L < 0 ? "left" : "right"}">
    <path class="scale" d="${arc(cx, cy, r, -60, 60)}"/>${ticks}
    <line class="ground" x1="12" x2="148" y1="${cy}" y2="${cy}"/>
    ${ps.slice(1).map((_, i) => needle(lean(i + 1), i + 1)).reverse().join("")}${ps.length ? needle(L, 0) : ""}
    <g transform="translate(${cx} ${cy}) rotate(${L.toFixed(1)}) scale(0.8)">
      <rect class="tyre" x="-4" y="-30" width="8" height="30" rx="4"/>
      <path class="bike" d="M-12,-22 L12,-22 L9,-42 L-9,-42 Z"/>
      <path class="body" transform="translate(${hang} 0)" d="M-9,-40 L9,-40 L7,-60 L-7,-60 Z"/>
      <circle class="helmet" cx="${hang * 1.5}" cy="-68" r="8"/>
    </g>
    <text class="rider-val" x="6" y="14">${Math.abs(L).toFixed(0)}° ${L < 0 ? "L" : "R"}</text>
  </svg>`;
}

/** Drag widgets by their title bar inside `layer`; positions are saved as they're dropped. */
export function wireDrag(layer: HTMLElement, onHide: (w: Widget) => void) {
  let z = 1;
  layer.querySelectorAll<HTMLElement>(".widget").forEach((el) => {
    const w = el.dataset.w as Widget, head = el.querySelector<HTMLElement>(".widget-head")!;
    el.querySelector(".widget-x")!.addEventListener("click", () => onHide(w));
    head.addEventListener("pointerdown", (e) => {
      // under the map on narrow screens, widgets sit in the page and don't move
      if ((e.target as Element).closest(".widget-x") || getComputedStyle(el).position !== "absolute") return;
      e.preventDefault();
      head.setPointerCapture(e.pointerId);
      el.style.zIndex = String(++z);
      const L = layer.getBoundingClientRect(), r = el.getBoundingClientRect();
      const ox = e.clientX - r.left, oy = e.clientY - r.top;
      let pos = widgetPos(w);
      const move = (ev: PointerEvent) => {
        const fx = L.width - r.width, fy = L.height - r.height;
        pos = {
          x: fx > 0 ? Math.min(1, Math.max(0, (ev.clientX - ox - L.left) / fx)) : 0,
          y: fy > 0 ? Math.min(1, Math.max(0, (ev.clientY - oy - L.top) / fy)) : 0,
        };
        el.setAttribute("style", `${place(pos.x, pos.y)};z-index:${z}`);
      };
      const up = () => {
        head.removeEventListener("pointermove", move);
        head.removeEventListener("pointerup", up);
        head.removeEventListener("pointercancel", up);
        setWidgetPos(w, pos);
      };
      head.addEventListener("pointermove", move);
      head.addEventListener("pointerup", up);
      head.addEventListener("pointercancel", up);
    });
  });
}
