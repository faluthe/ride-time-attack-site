import "./style.css";
import { initTheme, toggleTheme, color } from "./theme/theme";
import { at, distAtTime, headingAt, load, loadTrace, near, type CareerResult, type Data, type Lap, type LapInfo, type Leaderboard, type Trace } from "./data";
import { esc, fmtGap, fmtTime, gearName, sessionDate } from "./format";
import { LEGEND, MAX_LAPS, MapView, lapRole, mapSVG, palette, type Box, type MapMode, type MarkerPos } from "./map";
import { DASHES, drawChart, setChartCursor, type ChartSpec, type Series } from "./charts";
import { boardsHTML, careerHTML, saveTiles } from "./saves";

const $ = <T extends Element = HTMLElement>(s: string) => document.querySelector<T>(s)!;

let DATA: Data = { tracks: {}, laps: [], leaderboards: [], career: [] };
const byTrack = new Map<string, LapInfo[]>();
const boardsBy = new Map<string, Leaderboard[]>();
const careerBy = new Map<string, CareerResult[]>();
/** How compare laps line up with the lap: at the same distance, or at the same lap time (ghosts). */
type Align = "distance" | "time";
// `lap` and `cmps` are index entries; their traces load on demand (see `full`)
const view: { track: string | null; lap: LapInfo | null; cmps: LapInfo[]; mode: MapMode; align: Align } = {
  track: null, lap: null, cmps: [], mode: "speed", align: "distance",
};
/** Whether the collapsed career section is open, kept across re-renders. */
let careerOpen = false;

const title = (k: string) => (DATA.tracks[k] ? `${DATA.tracks[k].venue} ${DATA.tracks[k].layout}` : k);
const lapsOf = (k: string) => byTrack.get(k) ?? [];
const sorted = (laps: LapInfo[]) => laps.slice().sort((a, b) => Number(b.valid) - Number(a.valid) || a.time - b.time);
const boardsOf = (k: string) => boardsBy.get(k) ?? [];
const careerOf = (k: string) => careerBy.get(k) ?? [];
/** Time Attack data: logged laps or saved leaderboards. Career results alone don't count. */
const hasData = (k: string) => lapsOf(k).length + boardsOf(k).length > 0;
/** Fastest valid logged lap on a layout. */
const best = (k: string) => Math.min(...lapsOf(k).filter((l) => l.valid).map((l) => l.time));
/** Fastest lap from any source (logged or saved), for the sidebar. */
const bestAny = (k: string) => Math.min(best(k), ...boardsOf(k).flatMap((b) => b.laps.map((l) => l.time)));

// ---------- tooltip ----------
const tip = $("#tooltip");
function showTip(html: string, x: number, y: number) {
  tip.innerHTML = html;
  tip.hidden = false;
  const r = tip.getBoundingClientRect();
  tip.style.left = Math.min(x + 14, innerWidth - r.width - 8) + "px";
  tip.style.top = Math.max(8, y - r.height - 10) + "px";
}
const hideTip = () => (tip.hidden = true);

// ---------- sidebar ----------
const lapCount = (n: number) => `${n} lap${n === 1 ? "" : "s"}`;
const navBtn = (k: string, label: string, time: number, count = "") =>
  `<li><button class="track-btn${hasData(k) ? "" : " none"}" data-k="${k}" aria-current="${k === view.track}">
    <span>${esc(label)}${count ? ` <span class="n">${count}</span>` : ""}</span><span class="t">${isFinite(time) ? fmtTime(time) : ""}</span></button></li>`;

function renderNav() {
  const q = $<HTMLInputElement>("#search").value.trim().toLowerCase();
  const all = $<HTMLInputElement>("#show-all").checked;
  const keys = Object.keys(DATA.tracks)
    .filter((k) => all || hasData(k))
    .filter((k) => !q || title(k).toLowerCase().includes(q))
    .sort((a, b) => title(a).localeCompare(title(b)));
  // layouts with logged laps lead; the rest follow, grouped by venue
  const logged = keys.filter((k) => lapsOf(k).length), rest = keys.filter((k) => !lapsOf(k).length);
  let html = logged.length ? `<li class="venue">Logged laps</li>` : "", venue = "";
  for (const k of logged) html += navBtn(k, title(k), best(k), lapCount(lapsOf(k).length));
  for (const k of rest) {
    const t = DATA.tracks[k];
    if (t.venue !== venue) { html += `<li class="venue">${esc(t.venue)}</li>`; venue = t.venue; }
    html += navBtn(k, `Layout ${t.layout}`, bestAny(k));
  }
  $("#track-list").innerHTML = html || `<li class="muted">No tracks match</li>`;
  $<HTMLSelectElement>("#track-select").innerHTML = [...logged, ...rest].map((k) =>
    `<option value="${k}" ${k === view.track ? "selected" : ""}>${esc(title(k))}${lapsOf(k).length ? ` · ${lapCount(lapsOf(k).length)}` : ""}</option>`).join("");
}

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
  if (view.cmps.length && view.mode === "speed") view.mode = "laps";
  renderNav();
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
  const had = view.cmps.length;
  if (lap !== view.lap) stop();
  view.lap = lap;
  view.cmps = cmps.filter((c, i) => c !== lap && cmps.indexOf(c) === i).slice(0, MAX_LAPS - 1);
  // one colour per lap reads best once there's more than one line on the map
  if (!had && view.cmps.length && view.mode === "speed") view.mode = "laps";
  if (!view.cmps.length && view.mode === "laps") view.mode = "speed";
  for (const l of shownInfo()) failed.delete(l.id);
  renderTrack();
}

// ---------- charts ----------
const pct = (a: number[]) => a.map((v) => v * 100);
// Each channel keeps its theme role (as in the logger); compare laps are the same role, dashed.
const all = (ch: keyof Trace, role: string, f: (a: number[]) => number[] = (a) => a) => (l: Lap, cs: Lap[]): Series[] =>
  [l, ...cs].flatMap((x, i) => x.trace[ch] ? [{ xs: x.trace.d, ys: f(x.trace[ch] as number[]), role, dash: i }] : []);

function specs(L: Lap, Cs: Lap[]): ChartSpec[] {
  const dashed = Cs.length ? `; compare laps dashed` : "";
  const s: ChartSpec[] = [
    { id: "v", title: "Speed", unit: "km/h", height: 180, series: all("v", "speed") },
    { id: "lean", title: "Lean angle", unit: "degrees, right positive", height: 150, zero: true,
      tickLabel: (v) => (v ? `${Math.abs(v)} ${v < 0 ? "L" : "R"}` : "0"), series: all("lean", "lean") },
  ];
  if (L.trace.thr && L.trace.brk) {
    s.push(
      { id: "inputs", title: "Throttle & brake", unit: `% of travel${dashed}; bars along the bottom = rear brake`,
        height: 150, range: [0, 100],
        series: (l, cs) => [...all("thr", "throttle", pct)(l, cs), ...all("brk", "brake", pct)(l, cs)],
        marks: (l, X, y) => rearMarks(l, X, y) },
      { id: "gear", title: "Gear", height: 110, range: [0, 6], ticks: [0, 1, 2, 3, 4, 5, 6], tickLabel: gearName,
        series: (l, cs) => all("gear", "gear")(l, cs).map((x) => ({ ...x, step: true })) },
      { id: "rpm", title: "Engine speed", unit: "% from idle to limiter", height: 130, range: [0, 100],
        series: all("rpm", "rpm", pct) },
    );
  }
  s.push({ id: "ax", title: "Braking & acceleration", unit: "g along the bike, from motion; below zero = slowing", height: 150, zero: true,
    tickLabel: (v) => v.toFixed(1), series: all("ax", "accent") });
  if (Cs.length) {
    s.push({ id: "delta", title: `Time gained / lost vs ${Cs.length > 1 ? "each compare lap" : `lap ${Cs[0].lap}`}`,
      unit: "seconds at the same distance, below zero = ahead", height: 130, zero: true,
      tickLabel: (v) => v.toFixed(2), series: (l, cs) => {
        const xs = l.trace.d.filter((d) => d >= 0);
        return cs.map((c, i) => ({ xs, ys: xs.map((d) => at(l.trace, l.trace.t, d) - at(c.trace, c.trace.t, d)), role: "accent", dash: i + 1 }));
      } });
  }
  return s;
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

/** Show the cursor everywhere: chart crosshairs, map markers, slider and readout. */
function showCursor() {
  const d = cursorAt();
  setChartCursor(d);
  const ps = d == null ? [] : positions(d);
  mapView?.setMarkers(ps.map(({ lap, d: dl }): MarkerPos => ({ x: at(lap.trace, lap.trace.x, dl), y: at(lap.trace, lap.trace.y, dl), hdg: headingAt(lap.trace, dl) })));
  const slider = document.querySelector<HTMLInputElement>("#scrub");
  if (slider && d != null) slider.value = String(d);
  const ro = document.querySelector("#readout");
  if (ro) ro.innerHTML = readoutHTML(d);
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
  if (scrub.held == null || scrub.held >= lapLen(L) - 1) scrub.held = L.trace.d[0];
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
    const t = at(L.trace, L.trace.t, scrub.held!) + ((now - scrub.last) / 1000) * scrub.speed;
    scrub.last = now;
    scrub.held = distAtTime(L.trace, t);
    showCursor();
    if (t >= L.trace.t[L.trace.t.length - 1]) return stop();
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

// ---------- track page ----------
function legend(laps: Lap[]): string {
  const L = laps[0];
  const modes: [MapMode, string][] = [["speed", "Speed"]];
  if (L.trace.thr) modes.push(["inputs", "Throttle & brake"]);
  modes.push(["g", "G-force"]);
  if (laps.length > 1) modes.push(["laps", "Laps"]);
  const seg = `<div class="seg" role="group" aria-label="Colour the racing line by">${modes.map(([m, n]) =>
    `<button type="button" data-mode="${m}" aria-pressed="${view.mode === m}">${n}</button>`).join("")}</div>`;
  if (view.mode === "laps") return seg + lapKeys(laps);
  const pal = palette(view.mode);
  const others = laps.length > 1 ? lapKeys(laps.slice(1), 1) : "";
  if (view.mode === "speed") {
    const v = L.trace.v;
    return `${seg}<div class="ramp-legend"><span>${Math.round(Math.min(...v))} km/h</span>
      <span class="ramp" style="background:linear-gradient(90deg,${pal.join(",")})"></span><span>${Math.round(Math.max(...v))} km/h</span></div>${others}`;
  }
  return `${seg}<div class="swatches">${LEGEND[view.mode].map((n, i) => `<span><i style="background:${pal[i]}"></i>${n}</span>`).join("")}</div>${others}`;
}

/** One key per lap: its map colour and its chart dash. */
function lapKeys(laps: Lap[], from = 0): string {
  const dash = (i: number) => `<svg class="dash-key" width="22" height="6" aria-hidden="true"><line x1="0" x2="22" y1="3" y2="3" stroke="currentColor" stroke-width="2"${DASHES[i] ? ` stroke-dasharray="${DASHES[i]}"` : ""}/></svg>`;
  return `<div class="swatches">${laps.map((l, k) => {
    const i = k + from;
    return `<span><i style="background:${color(lapRole(i))}"></i>${dash(i)}Lap ${l.lap} · ${fmtTime(l.time)}</span>`;
  }).join("")}</div>`;
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

function mapTools(n: number): string {
  return `<div class="map-tools">
      <button type="button" class="icon-btn" data-zoom="in" aria-label="Zoom in">+</button>
      <button type="button" class="icon-btn" data-zoom="out" aria-label="Zoom out">−</button>
      <button type="button" class="icon-btn" data-zoom="fit" aria-label="Show the whole layout">⤢</button>
      <label class="toggle"><input type="checkbox" id="follow" ${follow ? "checked" : ""}> Follow</label>
      ${n > 1 ? `<div class="seg" role="group" aria-label="Line compare laps up by">
        <button type="button" data-align="distance" aria-pressed="${view.align === "distance"}" title="Every marker at the same lap distance">Same distance</button>
        <button type="button" data-align="time" aria-pressed="${view.align === "time"}" title="Every marker at the same lap time, like racing a ghost">Same time</button></div>` : ""}
    </div>`;
}

function renderTrack() {
  const k = view.track!, t = DATA.tracks[k], Li = view.lap;
  const laps = sorted(lapsOf(k));
  const b = best(k);
  const opt = (l: LapInfo, sel = false) => `<option value="${esc(l.id)}" ${sel ? "selected" : ""}>${fmtTime(l.time)} · lap ${l.lap} · ${sessionDate(l.session)}${l.valid ? "" : " · invalid"}</option>`;
  const main = $("#main");
  if (mapView) mapBox = mapView.view;
  mapView = null;
  syncUrl();
  if (!Li) {
    main.innerHTML = `<header class="page-head"><h2>${esc(t.venue)}</h2><p class="muted">Layout ${esc(t.layout)} · ${(t.length_m / 1000).toFixed(2)} km</p></header>
      <div class="hero"><section class="card map-card"><div class="map-wrap">${mapSVG(t, [], view.mode)}</div>
        <p class="muted note">No logged laps here yet: ride with the logger running, then run rta-export.</p></section>
        <div class="tiles">${saveTiles(boardsOf(k), t.length_m)}</div></div>
      ${boardsHTML(boardsOf(k), t.length_m)}
      ${careerHTML(careerOf(k), careerOpen)}`;
    return;
  }
  for (const l of shownInfo()) fetchTrace(l);
  // Summaries come from the index; the map lines and charts wait for the traces.
  const L = full(Li), shown = shownLaps(), Cs = L ? shown.slice(1) : [];
  const lapStatus = traceStatus(Li, `lap ${Li.lap}`);
  const status = lapStatus || view.cmps.map((c) => traceStatus(c, `lap ${c.lap} to compare`)).find(Boolean) || "";
  const sp = L ? specs(L, Cs) : [];
  const cmpChips = view.cmps.map((c, i) => `<span class="chip"><i style="background:${color(lapRole(i + 1))}"></i>Lap ${c.lap} · ${fmtTime(c.time)}
      <button type="button" class="chip-x" data-drop="${esc(c.id)}" aria-label="Stop comparing lap ${c.lap}">×</button></span>`).join("");
  const addable = laps.filter((l) => l !== Li && !view.cmps.includes(l));
  main.innerHTML = `
    <header class="page-head"><h2>${esc(t.venue)}</h2><p class="muted">Layout ${esc(t.layout)} · ${(t.length_m / 1000).toFixed(2)} km · ${laps.length} logged lap${laps.length === 1 ? "" : "s"}</p></header>
    <div class="hero">
      <section class="card map-card">
        ${L ? mapTools(shown.length) : ""}<div class="map-wrap">${mapSVG(t, L ? shown : [], view.mode)}</div>
        ${L ? transport(L) + legend(shown) : `<p class="muted note">${lapStatus}</p>`}
      </section>
      <div class="tiles">${tiles(Li, k)}</div>
    </div>
    <section class="card">
      <div class="lap-pick">
        <label>Lap <select id="lap-sel">${laps.map((l) => opt(l, l === Li)).join("")}</select></label>
        <label>Compare with <select id="cmp-add" ${view.cmps.length >= MAX_LAPS - 1 || !addable.length ? "disabled" : ""}>
          <option value="">${view.cmps.length >= MAX_LAPS - 1 ? `Up to ${MAX_LAPS - 1} laps` : "Add a lap…"}</option>${addable.map((l) => opt(l)).join("")}</select></label>
        <div class="chips">${cmpChips}</div>
      </div>
      ${status ? `<p class="muted note" role="status">${status}</p>` : ""}
      <div id="readout" class="readout" aria-live="off">${L ? readoutHTML(cursorAt()) : ""}</div>
      ${sp.map((s) => `<h4>${s.title}${s.unit ? ` <span class="muted">${s.unit}</span>` : ""}</h4><div class="chart" data-ch="${s.id}"></div>`).join("")}
    </section>
    <section class="card">
      <h3>Logged laps</h3>
      <div class="scroll"><table><thead><tr><th>Lap</th><th>Session</th><th class="r">Time</th><th class="r">Gap</th><th class="r">Top km/h</th><th class="r">Lean L / R</th><th class="r">Full throttle</th><th></th><th></th></tr></thead><tbody>
      ${laps.map((l) => `<tr class="${l === Li ? "current" : ""}" data-id="${esc(l.id)}"><td>${l.lap}</td><td>${sessionDate(l.session)}</td><td class="r" title="${l.game_timed ? "Timed by the game" : "Measured at the track spline start (±0.1 s)"}">${fmtTime(l.time)}${l.game_timed ? "" : "<span class=\"approx\">≈</span>"}</td>
        <td class="r">${l.valid && isFinite(b) ? fmtGap(l.time - b) : "–"}</td><td class="r">${Math.round(l.top_speed)}</td>
        <td class="r">${Math.round(-l.max_lean_left)}° / ${Math.round(l.max_lean_right)}°</td><td class="r">${l.full_throttle_pct != null ? Math.round(l.full_throttle_pct) + "%" : "–"}</td>
        <td>${l.valid ? "" : `<span class="pill">${esc(l.problem ?? "invalid")}</span>`}</td>
        <td>${l === Li ? "" : `<label class="cmp-box" title="Compare with this lap"><input type="checkbox" data-cmp="${esc(l.id)}" ${view.cmps.includes(l) ? "checked" : ""}
          ${!view.cmps.includes(l) && view.cmps.length >= MAX_LAPS - 1 ? "disabled" : ""}> compare</label>`}</td></tr>`).join("")}
      </tbody></table></div>
    </section>
    ${boardsHTML(boardsOf(k), t.length_m)}
    ${careerHTML(careerOf(k), careerOpen)}`;
  drawCharts();
  const byId = (id: string) => laps.find((l) => l.id === id) ?? null;
  if (L) {
    mapView = new MapView($<SVGSVGElement>(".map"), L, hooks);
    mapView.follow = follow;
    mapView.onZoom = syncUrl;
    mapView.restore(mapBox);
    if (startZoom) {
      const d = cursorAt(), p = d == null ? null : positions(d)[0];
      if (p) mapView.centre(at(p.lap.trace, p.lap.trace.x, p.d), at(p.lap.trace, p.lap.trace.y, p.d), startZoom);
      startZoom = 0;
    }
    showCursor();
    main.querySelectorAll<HTMLButtonElement>("[data-zoom]").forEach((btn) => btn.addEventListener("click", () => {
      const z = btn.dataset.zoom;
      if (z === "fit") mapView?.reset(); else mapView?.zoomBy(z === "in" ? 1.6 : 1 / 1.6);
      showCursor();
    }));
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
  main.querySelectorAll<HTMLButtonElement>(".seg button[data-mode]").forEach((btn) =>
    btn.addEventListener("click", () => { view.mode = btn.dataset.mode as MapMode; renderTrack(); }));
  $<HTMLSelectElement>("#lap-sel").addEventListener("change", (e) => pick(byId((e.target as HTMLSelectElement).value), view.cmps));
  $<HTMLSelectElement>("#cmp-add").addEventListener("change", (e) => {
    const l = byId((e.target as HTMLSelectElement).value);
    if (l) pick(view.lap, [...view.cmps, l]);
  });
  main.querySelectorAll<HTMLButtonElement>("[data-drop]").forEach((btn) =>
    btn.addEventListener("click", () => pick(view.lap, view.cmps.filter((c) => c.id !== btn.dataset.drop))));
  main.querySelectorAll<HTMLTableRowElement>("tbody tr[data-id]").forEach((tr) =>
    tr.addEventListener("click", (e) => {
      const box = (e.target as Element).closest<HTMLElement>(".cmp-box");
      if (!box) return pick(byId(tr.dataset.id!), view.cmps);
      const input = box.querySelector<HTMLInputElement>("input")!;
      if (e.target !== input) return;
      const l = byId(input.dataset.cmp!)!;
      pick(view.lap, input.checked ? [...view.cmps, l] : view.cmps.filter((c) => c !== l));
    }));
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
async function boot() {
  initTheme(() => view.track && renderTrack());
  $("#theme").addEventListener("click", () => { toggleTheme(); if (view.track) renderTrack(); });
  $("#search").addEventListener("input", renderNav);
  $("#show-all").addEventListener("change", renderNav);
  $("#track-list").addEventListener("click", (e) => {
    const b = (e.target as Element).closest<HTMLButtonElement>(".track-btn");
    if (b) select(b.dataset.k!);
  });
  $("#track-select").addEventListener("change", (e) => select((e.target as HTMLSelectElement).value));
  let rt: number | undefined;
  addEventListener("resize", () => { clearTimeout(rt); rt = window.setTimeout(() => { drawCharts(); showCursor(); }, 150); });
  // hover text for leaderboard gap bars and career sectors
  document.addEventListener("pointermove", (e) => {
    const el = (e.target as Element).closest<HTMLElement>("[data-tip]");
    if (el) showTip(el.dataset.tip!, e.clientX, e.clientY);
  });
  document.addEventListener("pointerout", (e) => { if ((e.target as Element).closest("[data-tip]")) hideTip(); });
  // `toggle` doesn't bubble, so listen in the capture phase
  document.addEventListener("toggle", (e) => {
    const el = e.target as Element;
    if (el.matches("details.career")) careerOpen = (el as HTMLDetailsElement).open;
  }, true);
  // space plays and pauses, arrows step 10 m (100 m with shift), escape lets go of the cursor
  document.addEventListener("keydown", (e) => {
    const tag = (e.target as Element).tagName;
    if (!full(view.lap) || e.ctrlKey || e.metaKey || e.altKey || ["INPUT", "SELECT", "TEXTAREA", "BUTTON"].includes(tag)) return;
    if (e.key === " ") { e.preventDefault(); scrub.playing ? stop() : play(); }
    else if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); nudge((e.key === "ArrowLeft" ? -1 : 1) * (e.shiftKey ? 100 : 10)); }
    else if (e.key === "Escape") { stop(); scrub.held = scrub.hover = null; showCursor(); }
  });

  try {
    DATA = await load();
  } catch (err) {
    $("#main").innerHTML = `<p class="empty">Couldn't load data (${esc((err as Error).message)}).<br>
      Run <code>cargo run --release --bin rta-export -- --out ../site/public/data</code> in the logger repo.</p>`;
    return;
  }
  for (const l of DATA.laps) byTrack.set(l.track, [...(byTrack.get(l.track) ?? []), l]);
  for (const b of DATA.leaderboards) boardsBy.set(b.track, [...(boardsBy.get(b.track) ?? []), b]);
  for (const c of DATA.career) if (c.track) careerBy.set(c.track, [...(careerBy.get(c.track) ?? []), c]);
  const when = DATA.generated ? ` · updated ${new Date(DATA.generated * 1000).toLocaleString()}` : "";
  $("#summary").textContent = `${DATA.laps.length} logged laps · ${DATA.leaderboards.length} saved leaderboards${when}`;
  const want = location.hash.slice(1);
  // open on a layout with logged laps if there is one, else any layout with saved data
  const byTitle = (a: string, b: string) => title(a).localeCompare(title(b));
  const first = [...byTrack.keys()].sort(byTitle)[0] ?? Object.keys(DATA.tracks).filter(hasData).sort(byTitle)[0];
  const k = DATA.tracks[want] ? want : first;
  if (k) {
    // deep links: ?lap=<id>&cmp=<id>[,<id>…]
    const q = new URLSearchParams(location.search), laps = lapsOf(k);
    const find = (id: string | null) => laps.find((l) => l.id === id) ?? null;
    const cmps = (q.get("cmp") ?? "").split(",").map(find).filter((l): l is LapInfo => !!l);
    // and ?at=<metres>&zoom=<factor>: a point on the lap, zoomed in around it
    const at = q.get("at"), zoom = Number(q.get("zoom"));
    select(k, find(q.get("lap")), cmps);
    if (at != null && isFinite(Number(at))) scrub.held = Number(at);
    if (zoom > 1) startZoom = zoom;
    renderTrack();
  }
  else { renderNav(); $("#main").innerHTML = `<p class="empty">No logged laps yet.</p>`; }
}

boot();
