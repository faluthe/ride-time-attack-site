// The laps page: a full-screen playback view of one logged lap (and up to three to compare), with
// the map filling the stage and the charts, readout and tiles as panels toggled from the toolbar.

import { color } from "./theme/theme";
import { at, distAtTime, headingAt, loadTrace, near, type Lap, type LapInfo, type Trace } from "./data";
import { esc, fmtGap, fmtTime, gearName, sessionDate } from "./format";
import { MAX_LAPS, MapView, inputBin, inputColours, lapRole, mapSVG, markerColour, type Box, type MapMode, type MarkerPos } from "./map";
import { drawChart, setChartCursor, type ChartSpec, type Series } from "./charts";
import { GRAPHS, PANEL_LABEL, WIDGETS, panelOn, setSideShare, sideShare, togglePanel, type Graph, type Panel, type Widget, mapWidth, setMapWidth } from "./panels";
import { riderHTML, tachHTML, timerHTML, widgetFrame, wireDrag } from "./widgets";
import { WIDTHS, widenLap, widenTrack } from "./widen";
import { $, DATA, best, boardsOf, boot, byTitle, careerOf, hashTrack, lapCount, lapsOf, pageLinks, title } from "./shell";

/** How compare laps line up with the lap: at the same distance, or at the same lap time (ghosts). */
type Align = "distance" | "time";
// `lap` and `cmps` are index entries; their traces load on demand (see `full`)
const view: { track: string | null; lap: LapInfo | null; cmps: LapInfo[]; mode: MapMode; align: Align } = {
  track: null, lap: null, cmps: [], mode: "inputs", align: "time",
};

const sorted = (laps: LapInfo[]) => laps.slice().sort((a, b) => Number(b.valid) - Number(a.valid) || a.time - b.time);

/** Keep the address bar on the current layout, laps and cursor, so the view can be linked. Debounced:
 * browsers limit how often `replaceState` may run, and dragging the cursor would exceed it. */
let urlTimer: number | undefined;
function syncUrl() {
  clearTimeout(urlTimer);
  urlTimer = window.setTimeout(writeUrl, 250);
}

function writeUrl() {
  const q = new URLSearchParams();
  if (view.lap) q.set("lap", view.lap.id);
  if (view.cmps.length) q.set("cmp", view.cmps.map((l) => l.id).join(","));
  if (scrub.held != null) q.set("at", String(Math.round(scrub.held)));
  const z = mapView?.zoom ?? 1;
  if (z > 1.05) q.set("zoom", z.toFixed(1));
  const s = q.toString();
  history.replaceState(null, "", `${location.pathname}${s ? "?" + s.replace(/%2C/g, ",") : ""}#${view.track ?? ""}`);
}

/** Open a layout, on its fastest lap unless `lap` is given. */
function select(k: string, lap: LapInfo | null = null, cmps: LapInfo[] = []) {
  if (k !== view.track) { stop(); scrub.held = null; mapBox = null; }
  view.track = k;
  view.lap = lap ?? sorted(lapsOf(k))[0] ?? null;
  view.cmps = cmps.filter((c) => c !== view.lap).slice(0, MAX_LAPS - 1);
  pageLinks(k);
  renderTrack();
}

// ---------- traces, loaded on demand ----------
const loaded = new Map<string, Lap>();
const failed = new Map<string, string>();
const pending = new Set<string>();

/** The lap with its trace, if it has loaded. */
const full = (l: LapInfo | null): Lap | null => (l ? loaded.get(l.id) ?? null : null);
const shownInfo = () => [view.lap, ...view.cmps].filter((l): l is LapInfo => !!l);

/** Start loading a lap's trace unless it's loaded, loading or failed; re-render when it lands. */
function fetchTrace(l: LapInfo) {
  if (loaded.has(l.id) || pending.has(l.id) || failed.has(l.id)) return;
  pending.add(l.id);
  loadTrace(l).then(
    (trace) => loaded.set(l.id, { ...l, trace }),
    (err: Error) => failed.set(l.id, err.message),
  ).finally(() => {
    pending.delete(l.id);
    if (shownInfo().some((x) => x.id === l.id)) renderTrack();
  });
}

/** Pick the lap and the compare laps; picking a lap that failed to load tries it again. */
function pick(lap: LapInfo | null, cmps: LapInfo[]) {
  if (lap !== view.lap) stop();
  view.lap = lap;
  view.cmps = cmps.filter((c, i) => c !== lap && cmps.indexOf(c) === i).slice(0, MAX_LAPS - 1);
  for (const l of shownInfo()) failed.delete(l.id);
  renderTrack();
}

// ---------- charts ----------
const pct = (a: number[]) => a.map((v) => v * 100);
// Each channel keeps its theme role (as in the logger); compare laps are the same role, dashed.
const all = (ch: keyof Trace, role: string, f: (a: number[]) => number[] = (a) => a) => (l: Lap, cs: Lap[]): Series[] =>
  [l, ...cs].flatMap((x, i) => x.trace[ch] ? [{ xs: x.trace.d, ys: f(x.trace[ch] as number[]), role, dash: i }] : []);

/** A chart, shown with the panel named by `panel` (or by its `id` when that's a panel name). */
type Spec = ChartSpec & { id: Graph | "strips"; panel?: Graph };
const panelOf = (s: Spec): Graph => s.panel ?? (s.id as Graph);

/** The charts this lap has data for. */
function specs(L: Lap, Cs: Lap[]): Spec[] {
  const dashed = Cs.length ? `; compare laps dashed` : "";
  const s: Spec[] = [
    { id: "speed", title: "Speed", unit: "km/h", height: 130, series: all("v", "speed") },
    { id: "lean", title: "Lean angle", unit: "degrees, right positive", height: 110, zero: true,
      tickLabel: (v) => (v ? `${Math.abs(v)} ${v < 0 ? "L" : "R"}` : "0"), series: all("lean", "lean") },
  ];
  if (L.trace.thr && L.trace.brk) {
    s.push(
      { id: "inputs", title: "Throttle & brake", unit: `% of travel${dashed}; bars along the bottom = rear brake`,
        height: 110, range: [0, 100],
        series: (l, cs) => [...all("thr", "throttle", pct)(l, cs), ...all("brk", "brake", pct)(l, cs)],
        marks: (l, X, y) => rearMarks(l, X, y) },
    );
    // overlaid, a compare lap's throttle and brake are hard to read: one strip per lap shows them apart
    const n = [L, ...Cs].filter((l) => l.trace.thr && l.trace.brk).length;
    if (n > 1) s.push({ id: "strips", panel: "inputs", title: "Throttle & brake by lap", unit: "same colours as the map's throttle & brake",
      height: 30 + n * 16, range: [0, n], ticks: [], series: () => [], marks: (l, X, _y, cs, Y) => inputStrips([l, ...cs], X, Y) });
    s.push(
      { id: "gear", title: "Gear", height: 90, range: [0, 6], ticks: [0, 2, 4, 6], tickLabel: gearName,
        series: (l, cs) => all("gear", "gear")(l, cs).map((x) => ({ ...x, step: true })) },
      { id: "rpm", title: "Engine speed", unit: "% from idle to limiter", height: 90, range: [0, 100],
        series: all("rpm", "rpm", pct) },
    );
  }
  s.push({ id: "g", title: "Braking & acceleration", unit: "g along the bike, from motion; below zero = slowing", height: 110, zero: true,
    tickLabel: (v) => v.toFixed(1), series: all("ax", "accent") });
  if (Cs.length) {
    s.push({ id: "delta", title: `Time gained / lost vs ${Cs.length > 1 ? "each compare lap" : `lap ${Cs[0].lap}`}`,
      unit: "seconds at the same distance, below zero = ahead", height: 100, zero: true,
      tickLabel: (v) => v.toFixed(2), series: (l, cs) => {
        const xs = l.trace.d.filter((d) => d >= 0);
        return cs.map((c, i) => ({ xs, ys: xs.map((d) => at(l.trace, l.trace.t, d) - at(c.trace, c.trace.t, d)), role: "accent", dash: i + 1 }));
      } });
  }
  return s;
}

/** One row per lap (the lap at the top), coloured by what the rider is doing along the lap. */
function inputStrips(laps: Lap[], X: (d: number) => number, Y: (v: number) => number): string {
  const pal = inputColours();
  const rows = laps.filter((l) => l.trace.thr && l.trace.brk);
  return rows.map((l, r) => {
    const { d, thr, brk, rear } = l.trace, top = Y(rows.length - r) + 1, h = Y(rows.length - r - 1) - top - 1;
    const bin = (i: number) => inputBin(thr![i], brk![i], rear ? rear[i] : 0);
    let out = `<text class="strip-label" x="${X(0) - 6}" y="${top + h / 2 + 4}" text-anchor="end">L${l.lap}</text>
      <rect x="${X(0) - 3}" y="${top}" width="2" height="${h}" fill="${color(lapRole(laps.indexOf(l)))}"/>`;
    for (let i = 0, start = 0; i <= d.length; i++) {
      if (i < d.length && bin(i) === bin(start)) continue;
      out += `<rect x="${X(d[start]).toFixed(1)}" y="${top}" width="${Math.max(0.5, X(d[Math.min(i, d.length - 1)]) - X(d[start])).toFixed(1)}" height="${h}" fill="${pal[bin(start)]}"/>`;
      start = i;
    }
    return out;
  }).join("");
}

function rearMarks(l: Lap, X: (d: number) => number, y: number): string {
  const { d, rear } = l.trace;
  if (!rear) return "";
  let out = "", start: number | null = null;
  for (let i = 0; i <= d.length; i++) {
    const on = i < d.length && rear[i] > 0.5;
    if (on && start == null) start = d[i];
    if (!on && start != null) {
      out += `<line class="rear" stroke="${color("rear")}" x1="${X(start)}" x2="${X(Math.max(d[i - 1], start + 3))}" y1="${y - 2}" y2="${y - 2}"/>`;
      start = null;
    }
  }
  return out;
}

// ---------- scrubbing and playback ----------
/**
 * The cursor is a lap distance on the lap being studied. `held` is where it was put (a click, a
 * drag, the slider, playback) and stays put; `hover` previews wherever the mouse is and wins
 * while it's there.
 */
const scrub: { held: number | null; hover: number | null; playing: boolean; speed: number; raf: number; last: number } = {
  held: null, hover: null, playing: false, speed: 1, raf: 0, last: 0,
};
let mapView: MapView | null = null;
/** The map's zoom and pan, kept while re-rendering the same layout. */
let mapBox: Box | null = null;
let follow = false;
/** Zoom from a deep link, applied around the cursor once the lap has loaded. */
let startZoom = 0;

const cursorAt = () => (scrub.playing ? scrub.held : scrub.hover ?? scrub.held);
const shownLaps = () => shownInfo().map(full).filter((l): l is Lap => !!l);
const lapLen = (L: Lap) => L.trace.d[L.trace.d.length - 1];

/** Where each shown lap is when the lap being studied is at distance `d`. */
function positions(d: number): { lap: Lap; d: number }[] {
  const [L, ...Cs] = shownLaps();
  if (!L) return [];
  const t = at(L.trace, L.trace.t, d);
  return [{ lap: L, d }, ...Cs.map((c) => ({ lap: c, d: view.align === "time" ? distAtTime(c.trace, t) : d }))];
}

const fmtClock = (t: number) => (t < 60 ? t.toFixed(3) : fmtTime(t));

function readoutHTML(d: number | null): string {
  const ps = d == null ? [] : positions(d);
  if (!ps.length) return `<p class="muted note">Hover or drag along the charts, click the line on the map, or press play.</p>`;
  const L = ps[0].lap, tL = at(L.trace, L.trace.t, d!);
  const rows = ps.map(({ lap, d: dl }, i) => {
    const t = lap.trace, tl = at(t, t.t, dl);
    const gear = t.gear ? gearName(near(t, t.gear, dl)) : "–";
    const inputs = t.thr && t.brk ? `${Math.round(at(t, t.thr, dl) * 100)}<span class="u">%</span> / ${Math.round(at(t, t.brk, dl) * 100)}<span class="u">%</span>${t.rear && near(t, t.rear, dl) ? " +R" : ""}` : "–";
    const lean = at(t, t.lean, dl);
    // time behind the lap at the same distance (+ = behind), and in ghost mode how far apart the bikes are
    const gap = i ? `${fmtGap(at(t, t.t, d!) - tL)} s${view.align === "time" ? ` · ${Math.round(d! - dl)} m` : ""}` : "";
    return `<tr><th><i class="key" style="--c:${color(lapRole(i))}"></i>Lap ${lap.lap} <span class="muted">${fmtTime(lap.time)}</span></th>
      <td class="r">${fmtClock(tl)}</td><td class="r">${Math.round(at(t, t.v, dl))}</td><td class="r">${Math.abs(lean).toFixed(0)}° ${lean < 0 ? "L" : "R"}</td>
      <td class="r">${gear}</td><td class="r">${inputs}</td><td class="r">${gap}</td></tr>`;
  }).join("");
  return `<table class="readout-table"><thead><tr><th>${(d! / 1000).toFixed(3)} km · ${fmtClock(tL)}</th><th class="r">Time</th><th class="r">km/h</th><th class="r">Lean</th>
    <th class="r">Gear</th><th class="r">Thr / brk</th><th class="r">${ps.length > 1 ? `Gap to lap ${L.lap}` : ""}</th></tr></thead><tbody>${rows}</tbody></table>`;
}

/** The widgets that follow the cursor, and how each draws itself. */
const LIVE: [Widget, (d: number | null) => string][] = [
  ["readout", readoutHTML],
  ["timer", (d) => timerHTML(d == null ? [] : positions(d))],
  ["tach", (d) => tachHTML(d == null ? [] : positions(d))],
  ["rider", (d) => riderHTML(d == null ? [] : positions(d))],
];

/** A rider on the map: on the (widened) line, in its line's colour there. */
function marker(lap: Lap, d: number, i: number): MarkerPos {
  const m = widenLap(lap, DATA.tracks[view.track!], mapWidth()).trace;
  return { x: at(m, m.x, d), y: at(m, m.y, d), hdg: headingAt(lap.trace, d), fill: markerColour(lap.trace, i, shading(), d) };
}

/** Show the cursor everywhere: chart crosshairs, map markers, slider and widgets. */
function showCursor() {
  const d = cursorAt();
  setChartCursor(d);
  const ps = d == null ? [] : positions(d);
  mapView?.setMarkers(ps.map(({ lap, d: dl }, i) => marker(lap, dl, i)));
  const slider = document.querySelector<HTMLInputElement>("#scrub");
  if (slider && d != null) slider.value = String(d);
  for (const [w, html] of LIVE) {
    const el = document.getElementById(`w-${w}`);
    if (el) el.innerHTML = html(d);
  }
}

const hooks = {
  hover: (d: number | null) => { if (!scrub.playing) { scrub.hover = d; showCursor(); } },
  pick: (d: number) => { stop(); scrub.held = d; scrub.hover = null; showCursor(); syncUrl(); },
};

function stop() {
  if (!scrub.playing) return;
  scrub.playing = false;
  cancelAnimationFrame(scrub.raf);
  syncUrl();
  const b = document.querySelector("#play");
  if (b) { b.textContent = "▶"; b.setAttribute("aria-label", "Play"); }
}

function play() {
  const L = full(view.lap);
  if (!L) return;
  if (scrub.held == null) scrub.held = L.trace.d[0];
  scrub.playing = true;
  scrub.hover = null;
  scrub.last = performance.now();
  const b = $("#play");
  b.textContent = "❚❚";
  b.setAttribute("aria-label", "Pause");
  const tick = (now: number) => {
    const L = full(view.lap);
    if (!scrub.playing || !L) return;
    // real time on the lap's own clock, so playback runs at the speed the lap was ridden
    const T = L.trace.t, t0 = T[0], t1 = T[T.length - 1];
    let t = at(L.trace, T, scrub.held!) + ((now - scrub.last) / 1000) * scrub.speed;
    // loop: past the end, carry on from the start
    if (t >= t1) t = t0 + ((t - t1) % (t1 - t0 || 1));
    scrub.last = now;
    scrub.held = distAtTime(L.trace, t);
    showCursor();
    scrub.raf = requestAnimationFrame(tick);
  };
  scrub.raf = requestAnimationFrame(tick);
}

/** Step the held cursor by `m` metres (keyboard). */
function nudge(m: number) {
  const L = full(view.lap);
  if (!L) return;
  stop();
  scrub.held = Math.min(lapLen(L), Math.max(L.trace.d[0], (scrub.held ?? 0) + m));
  scrub.hover = null;
  showCursor();
}

// ---------- the playback view ----------
/** How the lines are shaded: by throttle and brake when the lap has them, else by speed. */
const shading = (): MapMode => (view.mode === "inputs" && full(view.lap)?.trace.thr ? "inputs" : "speed");

function shadeSeg(L: Lap): string {
  if (!L.trace.thr) return "";
  const modes: [MapMode, string, string][] = [
    ["inputs", "Inputs", "Bright on the throttle, dim on the brakes"], ["speed", "Speed", "Bright where fast, dim where slow"]];
  return `<div class="seg" role="group" aria-label="Shade the racing lines by">${modes.map(([m, n, tip]) =>
    `<button type="button" data-mode="${m}" aria-pressed="${shading() === m}" title="${tip}">${n}</button>`).join("")}</div>`;
}

function tiles(L: LapInfo, k: string): string {
  const b = best(k);
  const tile = (label: string, value: string, hint = "") =>
    `<div class="tile"><div class="label">${label}</div><div class="value">${value}</div>${hint ? `<div class="hint">${hint}</div>` : ""}</div>`;
  return [
    tile("Lap time", fmtTime(L.time), [
      L.valid ? (L.time === b ? "Fastest logged lap" : `${fmtGap(L.time - b)} to fastest`) : `Invalid: ${esc(L.problem)}`,
      L.game_timed ? "timed by the game" : "measured, ±0.1 s",
    ].join(" · ")),
    tile("Top speed", `${Math.round(L.top_speed)} km/h`, `Average ${L.avg_speed.toFixed(1)} km/h`),
    tile("Max lean", `${Math.round(-L.max_lean_left)}° L / ${Math.round(L.max_lean_right)}° R`),
    tile("Hardest braking", `${L.max_brake_g.toFixed(2)} g`, `Hardest drive ${L.max_accel_g.toFixed(2)} g`),
    L.full_throttle_pct != null ? tile("Full throttle", `${Math.round(L.full_throttle_pct)}%`, "Share of the lap over 95%") : "",
    L.braking_pct != null ? tile("On the brakes", `${Math.round(L.braking_pct)}%`, `Top gear ${L.top_gear}`) : "",
  ].join("");
}

/** Loading or error text for a lap whose trace isn't there yet, or "" once it is. */
function traceStatus(l: LapInfo | null, what: string): string {
  if (!l || loaded.has(l.id)) return "";
  const err = failed.get(l.id);
  return err ? `Couldn't load ${what} (${esc(err)}). Pick it again to retry.` : `Loading ${what}…`;
}

const SPEEDS = [0.25, 0.5, 1, 2, 4];

function transport(L: Lap): string {
  return `<div class="transport">
      <button type="button" id="play" class="icon-btn" aria-label="${scrub.playing ? "Pause" : "Play"}">${scrub.playing ? "❚❚" : "▶"}</button>
      <input type="range" id="scrub" aria-label="Lap distance" min="${L.trace.d[0]}" max="${lapLen(L)}" step="0.1" value="${scrub.held ?? L.trace.d[0]}">
      <select id="speed" aria-label="Playback speed">${SPEEDS.map((s) => `<option value="${s}" ${s === scrub.speed ? "selected" : ""}>${s === 0.25 ? "¼" : s === 0.5 ? "½" : s}×</option>`).join("")}</select>
    </div>`;
}

function mapTools(L: Lap, n: number): string {
  return `<div class="map-tools">
      <button type="button" class="icon-btn" data-zoom="in" aria-label="Zoom in">+</button>
      <button type="button" class="icon-btn" data-zoom="out" aria-label="Zoom out">−</button>
      <button type="button" class="icon-btn" data-zoom="fit" aria-label="Show the whole layout">⤢</button>
      <label class="toggle"><input type="checkbox" id="follow" ${follow ? "checked" : ""}> Follow</label>
      <label class="toggle" title="Draw the track wider than life, so close lines separate">Width <select id="width" aria-label="Track width on the map">
        ${WIDTHS.map((w) => `<option value="${w}" ${w === mapWidth() ? "selected" : ""}>${w}×</option>`).join("")}</select></label>
      ${shadeSeg(L)}
      ${n > 1 ? `<div class="seg" role="group" aria-label="Line compare laps up by">
        <button type="button" data-align="distance" aria-pressed="${view.align === "distance"}" title="Every marker at the same lap distance">Same distance</button>
        <button type="button" data-align="time" aria-pressed="${view.align === "time"}" title="Every marker at the same lap time, like racing a ghost">Same time</button></div>` : ""}
    </div>`;
}

/** The layout picker: layouts with logged laps (plus the open one, if it has none). */
function trackPicker(k: string): string {
  const keys = Object.keys(DATA.tracks).filter((x) => lapsOf(x).length || x === k).sort(byTitle);
  return `<select id="track-sel" aria-label="Layout">${keys.map((x) =>
    `<option value="${esc(x)}" ${x === k ? "selected" : ""}>${esc(title(x))}${lapsOf(x).length ? ` · ${lapCount(lapsOf(x).length)}` : ""}</option>`).join("")}</select>`;
}

/** One toggle per panel, graphs and widgets apart; a panel the open laps have no data for is greyed out. */
function panelToggles(have: Set<Panel> | null): string {
  const group = (label: string, ps: readonly Panel[]) => `<div class="panel-toggles" role="group" aria-label="${label}">
    <span class="group-label">${label}</span>${ps.map((p) => {
    const none = have && !have.has(p);
    return `<button type="button" data-panel="${p}" aria-pressed="${panelOn(p)}"${none ? ` class="none" title="${p === "delta" ? "Compare a lap to see the delta" : "No data for this on the lap"}"` : ""}>${PANEL_LABEL[p]}</button>`;
  }).join("")}</div>`;
  return `<div class="panel-groups">${group("Graphs", GRAPHS)}${group("Widgets", WIDGETS)}</div>`;
}

/** The logged laps on this layout, for the "All laps" dialog: click a row to open it, tick to compare. */
function lapsTable(k: string): string {
  const laps = sorted(lapsOf(k)), b = best(k), Li = view.lap;
  return `<div class="dialog-head"><h3>${esc(title(k))} <span class="muted">${lapCount(laps.length)}</span></h3>
      <button type="button" class="icon-btn" data-close aria-label="Close">×</button></div>
    <div class="scroll"><table><thead><tr><th>Lap</th><th>Session</th><th class="r">Time</th><th class="r">Gap</th><th class="r">Top km/h</th><th class="r">Lean L / R</th><th class="r">Full throttle</th><th></th><th></th></tr></thead><tbody>
    ${laps.map((l) => `<tr class="${l === Li ? "current" : ""}" data-id="${esc(l.id)}"><td>${l.lap}</td><td>${sessionDate(l.session)}</td><td class="r" title="${l.game_timed ? "Timed by the game" : "Measured at the track spline start (±0.1 s)"}">${fmtTime(l.time)}${l.game_timed ? "" : "<span class=\"approx\">≈</span>"}</td>
      <td class="r">${l.valid && isFinite(b) ? fmtGap(l.time - b) : "–"}</td><td class="r">${Math.round(l.top_speed)}</td>
      <td class="r">${Math.round(-l.max_lean_left)}° / ${Math.round(l.max_lean_right)}°</td><td class="r">${l.full_throttle_pct != null ? Math.round(l.full_throttle_pct) + "%" : "–"}</td>
      <td>${l.valid ? "" : `<span class="pill">${esc(l.problem ?? "invalid")}</span>`}</td>
      <td>${l === Li ? "" : `<label class="cmp-box" title="Compare with this lap"><input type="checkbox" data-cmp="${esc(l.id)}" ${view.cmps.includes(l) ? "checked" : ""}
        ${!view.cmps.includes(l) && view.cmps.length >= MAX_LAPS - 1 ? "disabled" : ""}> compare</label>`}</td></tr>`).join("")}
    </tbody></table></div>`;
}

const byId = (id: string) => lapsOf(view.track!).find((l) => l.id === id) ?? null;

function renderTrack() {
  const k = view.track!, t = DATA.tracks[k], Li = view.lap;
  const main = $("#main");
  if (mapView) mapBox = mapView.view;
  mapView = null;
  syncUrl();
  const head = `<span class="layout-meta muted">${(t.length_m / 1000).toFixed(2)} km</span>`;
  if (!Li) {
    const saved = boardsOf(k).length || careerOf(k).length;
    main.innerHTML = `<div class="toolbar">${trackPicker(k)}${head}</div>
      <div class="stage solo"><section class="map-pane"><div class="map-wrap">${mapSVG(t, [], shading())}</div>
        <p class="muted note">No logged laps here yet: ride with the logger running, then run rta-export.${saved ? ` The game's saved times for this layout are under <a href="records.html#${esc(k)}">Records</a>.` : ""}</p></section></div>`;
    $("#laps-dialog").innerHTML = "";
    wireToolbar();
    return;
  }
  for (const l of shownInfo()) fetchTrace(l);
  // Summaries come from the index; the map lines and charts wait for the traces.
  const L = full(Li), shown = shownLaps(), Cs = L ? shown.slice(1) : [];
  const laps = sorted(lapsOf(k));
  const opt = (l: LapInfo, sel = false) => `<option value="${esc(l.id)}" ${sel ? "selected" : ""}>${fmtTime(l.time)} · lap ${l.lap} · ${sessionDate(l.session)}${l.valid ? "" : " · invalid"}</option>`;
  const lapStatus = traceStatus(Li, `lap ${Li.lap}`);
  const status = lapStatus || view.cmps.map((c) => traceStatus(c, `lap ${c.lap} to compare`)).find(Boolean) || "";
  const sp = L ? specs(L, Cs) : [];
  const charts = sp.filter((s) => panelOn(panelOf(s)));
  const side = charts.length > 0;
  const live = new Map(LIVE);
  const widgets = L ? WIDGETS.filter((w) => panelOn(w) && (w !== "tach" || L.trace.rpm))
    .map((w) => widgetFrame(w, w === "tiles" ? `<div class="tiles">${tiles(Li, k)}</div>` : live.get(w)!(cursorAt()))).join("") : "";
  const cmpChips = view.cmps.map((c, i) => `<span class="chip"><i style="background:${color(lapRole(i + 1))}"></i>Lap ${c.lap} · ${fmtTime(c.time)}
      <button type="button" class="chip-x" data-drop="${esc(c.id)}" aria-label="Stop comparing lap ${c.lap}">×</button></span>`).join("");
  const addable = laps.filter((l) => l !== Li && !view.cmps.includes(l));
  const maxed = view.cmps.length >= MAX_LAPS - 1;
  main.innerHTML = `
    <div class="toolbar">
      ${trackPicker(k)}
      <select id="lap-sel" aria-label="Lap">${laps.map((l) => opt(l, l === Li)).join("")}</select>
      <select id="cmp-add" aria-label="Compare with" ${maxed || !addable.length ? "disabled" : ""}>
        <option value="">${maxed ? `Comparing ${MAX_LAPS - 1} laps` : "Compare with…"}</option>${addable.map((l) => opt(l)).join("")}</select>
      ${cmpChips ? `<div class="chips">${cmpChips}</div>` : ""}
      <button type="button" class="tool-btn" id="all-laps" aria-haspopup="dialog">All laps</button>
      ${panelToggles(L ? new Set<Panel>([...sp.map(panelOf), ...WIDGETS.filter((w) => w !== "tach" || L.trace.rpm)]) : null)}
    </div>
    <div class="stage${side ? "" : " solo"}" style="--side:${sideShare()}">
      <section class="map-pane">
        ${L ? mapTools(L, shown.length) : ""}
        <div class="map-wrap">${mapSVG(widenTrack(t, mapWidth()), L ? shown.map((l) => widenLap(l, t, mapWidth())) : [], shading())}
          ${widgets ? `<div class="widget-layer">${widgets}</div>` : ""}</div>
        ${status ? `<p class="muted note" role="status">${status}</p>` : ""}
        ${L ? transport(L) : ""}
      </section>
      ${side ? `<div class="side-resize" role="separator" aria-orientation="vertical" aria-label="Resize the graphs" title="Drag to resize the graphs"></div>
      <aside class="side-panels" aria-label="Graphs">
        ${charts.map((s) => `<h4>${s.title}${s.unit ? ` <span class="muted">${s.unit}</span>` : ""}</h4><div class="chart" data-ch="${s.id}"></div>`).join("")}
      </aside>` : ""}
    </div>`;
  $("#laps-dialog").innerHTML = lapsTable(k);
  drawCharts();
  wireToolbar();
  const layer = main.querySelector<HTMLElement>(".widget-layer");
  if (layer) wireDrag(layer, (w) => { togglePanel(w); renderTrack(); });
  const resizer = main.querySelector<HTMLElement>(".side-resize");
  if (resizer) wireResize(resizer);
  if (L) {
    mapView = new MapView($<SVGSVGElement>(".map"), widenLap(L, t, mapWidth()), hooks);
    mapView.follow = follow;
    mapView.onZoom = syncUrl;
    mapView.restore(mapBox);
    if (startZoom) {
      const d = cursorAt(), p = d == null ? null : positions(d)[0];
      if (p) { const m = marker(p.lap, p.d, 0); mapView.centre(m.x, m.y, startZoom); }
      startZoom = 0;
    }
    showCursor();
    main.querySelectorAll<HTMLButtonElement>("[data-zoom]").forEach((btn) => btn.addEventListener("click", () => {
      const z = btn.dataset.zoom;
      if (z === "fit") mapView?.reset(); else mapView?.zoomBy(z === "in" ? 1.6 : 1 / 1.6);
      showCursor();
    }));
    $<HTMLSelectElement>("#width").addEventListener("change", (e) => {
      // the widened layout has a different extent, so start again from the whole of it
      setMapWidth(Number((e.target as HTMLSelectElement).value));
      mapBox = null;
      renderTrack();
    });
    $<HTMLInputElement>("#follow").addEventListener("change", (e) => {
      follow = (e.target as HTMLInputElement).checked;
      if (mapView) mapView.follow = follow;
      showCursor();
    });
    $("#play").addEventListener("click", () => (scrub.playing ? stop() : play()));
    $<HTMLInputElement>("#scrub").addEventListener("input", (e) => hooks.pick(Number((e.target as HTMLInputElement).value)));
    $<HTMLSelectElement>("#speed").addEventListener("change", (e) => { scrub.speed = Number((e.target as HTMLSelectElement).value); });
    main.querySelectorAll<HTMLButtonElement>("[data-align]").forEach((btn) => btn.addEventListener("click", () => {
      view.align = btn.dataset.align as Align;
      main.querySelectorAll("[data-align]").forEach((x) => x.setAttribute("aria-pressed", String(x === btn)));
      showCursor();
    }));
  }
}

/** Drag the edge of the graph column to resize it; the charts redraw to the new width as it moves. */
function wireResize(handle: HTMLElement) {
  const stage = handle.parentElement!;
  let raf = 0;
  handle.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    const r = stage.getBoundingClientRect();
    const move = (ev: PointerEvent) => {
      setSideShare((r.right - ev.clientX) / r.width);
      stage.style.setProperty("--side", String(sideShare()));
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => { drawCharts(); showCursor(); });
    };
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  });
}

/** Toolbar and map controls (the parts that exist with or without a loaded lap). */
function wireToolbar() {
  const main = $("#main");
  $<HTMLSelectElement>("#track-sel").addEventListener("change", (e) => select((e.target as HTMLSelectElement).value));
  if (!view.lap) return;
  main.querySelectorAll<HTMLButtonElement>(".seg button[data-mode]").forEach((btn) =>
    btn.addEventListener("click", () => { view.mode = btn.dataset.mode as MapMode; renderTrack(); }));
  main.querySelectorAll<HTMLButtonElement>("[data-panel]").forEach((btn) =>
    btn.addEventListener("click", () => { togglePanel(btn.dataset.panel as Panel); renderTrack(); }));
  $<HTMLSelectElement>("#lap-sel").addEventListener("change", (e) => pick(byId((e.target as HTMLSelectElement).value), view.cmps));
  $<HTMLSelectElement>("#cmp-add").addEventListener("change", (e) => {
    const l = byId((e.target as HTMLSelectElement).value);
    if (l) pick(view.lap, [...view.cmps, l]);
  });
  main.querySelectorAll<HTMLButtonElement>("[data-drop]").forEach((btn) =>
    btn.addEventListener("click", () => pick(view.lap, view.cmps.filter((c) => c.id !== btn.dataset.drop))));
  $("#all-laps").addEventListener("click", () => $<HTMLDialogElement>("#laps-dialog").showModal());
}

function drawCharts() {
  const L = full(view.lap);
  if (!L || !view.track) return;
  const length = DATA.tracks[view.track].length_m;
  const Cs = shownLaps().slice(1);
  const sp = specs(L, Cs);
  document.querySelectorAll<HTMLElement>(".chart").forEach((el) => {
    const s = sp.find((x) => x.id === el.dataset.ch);
    if (s) drawChart(el, s, L, Cs, length, hooks);
  });
  setChartCursor(cursorAt());
}

// ---------- boot ----------
async function start() {
  const dialog = $<HTMLDialogElement>("#laps-dialog");
  // the dialog's contents are re-rendered with the page, so listen on the dialog itself
  dialog.addEventListener("click", (e) => {
    const el = e.target as Element;
    if (el === dialog || el.closest("[data-close]")) return dialog.close();
    const tr = el.closest<HTMLTableRowElement>("tbody tr[data-id]");
    if (!tr) return;
    const box = el.closest<HTMLElement>(".cmp-box");
    if (!box) { dialog.close(); return pick(byId(tr.dataset.id!), view.cmps); }
    const input = box.querySelector<HTMLInputElement>("input")!;
    if (el !== input) return;
    const l = byId(input.dataset.cmp!)!;
    pick(view.lap, input.checked ? [...view.cmps, l] : view.cmps.filter((c) => c !== l));
  });
  let rt: number | undefined;
  addEventListener("resize", () => { clearTimeout(rt); rt = window.setTimeout(() => { drawCharts(); showCursor(); }, 150); });
  // space plays and pauses, arrows step 10 m (100 m with shift), escape lets go of the cursor
  document.addEventListener("keydown", (e) => {
    const tag = (e.target as Element).tagName;
    if (!full(view.lap) || dialog.open || e.ctrlKey || e.metaKey || e.altKey || ["INPUT", "SELECT", "TEXTAREA", "BUTTON"].includes(tag)) return;
    if (e.key === " ") { e.preventDefault(); scrub.playing ? stop() : play(); }
    else if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); nudge((e.key === "ArrowLeft" ? -1 : 1) * (e.shiftKey ? 100 : 10)); }
    else if (e.key === "Escape") { stop(); scrub.held = scrub.hover = null; showCursor(); }
  });
  // the header's Laps link (and edited addresses) only change the hash
  addEventListener("hashchange", () => { const k = hashTrack(); if (k && k !== view.track) select(k); });

  if (!(await boot(() => view.track && renderTrack()))) return;
  // open on a layout with logged laps if there is one
  const k = hashTrack() ?? Object.keys(DATA.tracks).filter((x) => lapsOf(x).length).sort(byTitle)[0];
  if (!k) {
    pageLinks(null);
    $("#main").innerHTML = `<p class="empty">No logged laps yet. The game's saved times are under <a href="records.html">Records</a>.</p>`;
    return;
  }
  // deep links: ?lap=<id>&cmp=<id>[,<id>…]
  const q = new URLSearchParams(location.search), laps = lapsOf(k);
  const find = (id: string | null) => laps.find((l) => l.id === id) ?? null;
  const cmps = (q.get("cmp") ?? "").split(",").map(find).filter((l): l is LapInfo => !!l);
  // and ?at=<metres>&zoom=<factor>: a point on the lap, zoomed in around it
  const atM = q.get("at"), zoom = Number(q.get("zoom"));
  if (atM != null && isFinite(Number(atM))) scrub.held = Number(atM);
  if (zoom > 1) startZoom = zoom;
  view.track = k;
  select(k, find(q.get("lap")), cmps);
}

start();
