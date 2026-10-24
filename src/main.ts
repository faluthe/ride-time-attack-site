import "./style.css";
import { initTheme, toggleTheme, color } from "./theme/theme";
import { at, load, loadTrace, near, type CareerResult, type Data, type Lap, type LapInfo, type Leaderboard, type Trace } from "./data";
import { esc, fmtGap, fmtTime, gearName, sessionDate } from "./format";
import { LEGEND, mapSVG, moveMapDot, palette, wireMap, type MapMode } from "./map";
import { drawChart, setChartCursor, type ChartSpec, type Series } from "./charts";
import { boardsHTML, careerHTML, saveTiles } from "./saves";

const $ = <T extends Element = HTMLElement>(s: string) => document.querySelector<T>(s)!;

let DATA: Data = { tracks: {}, laps: [], leaderboards: [], career: [] };
const byTrack = new Map<string, LapInfo[]>();
const boardsBy = new Map<string, Leaderboard[]>();
const careerBy = new Map<string, CareerResult[]>();
// `lap` and `cmp` are index entries; their traces load on demand (see `full`)
const view: { track: string | null; lap: LapInfo | null; cmp: LapInfo | null; mode: MapMode } = {
  track: null, lap: null, cmp: null, mode: "speed",
};

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

/** Open a layout, on its fastest lap unless `lap` is given. */
function select(k: string, lap: LapInfo | null = null, cmp: LapInfo | null = null) {
  view.track = k;
  view.lap = lap ?? sorted(lapsOf(k))[0] ?? null;
  view.cmp = cmp === view.lap ? null : cmp;
  history.replaceState(null, "", "#" + k);
  renderNav();
  renderTrack();
}

// ---------- traces, loaded on demand ----------
const loaded = new Map<string, Lap>();
const failed = new Map<string, string>();
const pending = new Set<string>();

/** The lap with its trace, if it has loaded. */
const full = (l: LapInfo | null): Lap | null => (l ? loaded.get(l.id) ?? null : null);

/** Start loading a lap's trace unless it's loaded, loading or failed; re-render when it lands. */
function fetchTrace(l: LapInfo) {
  if (loaded.has(l.id) || pending.has(l.id) || failed.has(l.id)) return;
  pending.add(l.id);
  loadTrace(l).then(
    (trace) => loaded.set(l.id, { ...l, trace }),
    (err: Error) => failed.set(l.id, err.message),
  ).finally(() => {
    pending.delete(l.id);
    if (view.lap?.id === l.id || view.cmp?.id === l.id) renderTrack();
  });
}

/** Pick a lap and compare lap; picking a lap that failed to load tries it again. */
function pick(lap: LapInfo | null, cmp: LapInfo | null) {
  view.lap = lap;
  view.cmp = cmp === lap ? null : cmp;
  for (const l of [view.lap, view.cmp]) if (l) failed.delete(l.id);
  renderTrack();
}

// ---------- charts ----------
const pct = (a: number[]) => a.map((v) => v * 100);
// Each channel keeps its theme role (as in the logger); a compare lap is the same role, dashed.
const both = (ch: keyof Trace, role: string) => (l: Lap, c: Lap | null): Series[] => {
  const out: Series[] = [{ xs: l.trace.d, ys: l.trace[ch] as number[], role }];
  if (c?.trace[ch]) out.push({ xs: c.trace.d, ys: c.trace[ch] as number[], role, dash: true });
  return out;
};

function specs(L: Lap, C: Lap | null): ChartSpec[] {
  const s: ChartSpec[] = [
    { id: "v", title: "Speed", unit: "km/h", height: 180, series: both("v", "speed") },
    { id: "lean", title: "Lean angle", unit: "degrees, right positive", height: 150, zero: true,
      tickLabel: (v) => (v ? `${Math.abs(v)} ${v < 0 ? "L" : "R"}` : "0"), series: both("lean", "lean") },
  ];
  if (L.trace.thr && L.trace.brk) {
    s.push(
      { id: "inputs", title: "Throttle & brake", unit: `% of travel${C ? `, lap ${C.lap} dashed` : ""}; bars along the bottom = rear brake`,
        height: 150, range: [0, 100],
        series: (l, c) => {
          const out: Series[] = [{ xs: l.trace.d, ys: pct(l.trace.thr!), role: "throttle" }, { xs: l.trace.d, ys: pct(l.trace.brk!), role: "brake" }];
          if (c?.trace.thr && c.trace.brk) out.push({ xs: c.trace.d, ys: pct(c.trace.thr), role: "throttle", dash: true }, { xs: c.trace.d, ys: pct(c.trace.brk), role: "brake", dash: true });
          return out;
        },
        marks: (l, X, y) => rearMarks(l, X, y) },
      { id: "gear", title: "Gear", height: 110, range: [0, 6], ticks: [0, 1, 2, 3, 4, 5, 6], tickLabel: gearName,
        series: (l, c) => both("gear", "gear")(l, c).map((x) => ({ ...x, step: true })) },
      { id: "rpm", title: "Engine speed", unit: "% from idle to limiter", height: 130, range: [0, 100],
        series: (l, c) => both("rpm", "rpm")(l, c).map((x) => ({ ...x, ys: pct(x.ys) })) },
    );
  }
  s.push({ id: "ax", title: "Braking & acceleration", unit: "g along the bike, from motion; below zero = slowing", height: 150, zero: true,
    tickLabel: (v) => v.toFixed(1), series: both("ax", "accent") });
  if (C) {
    s.push({ id: "delta", title: `Time gained / lost vs lap ${C.lap}`, unit: "seconds, below zero = ahead", height: 130, zero: true,
      tickLabel: (v) => v.toFixed(2), series: (l, c) => {
        const xs = l.trace.d.filter((d) => d >= 0);
        return [{ xs, ys: xs.map((d) => at(l.trace, l.trace.t, d) - at(c!.trace, c!.trace.t, d)), role: "accent" }];
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

function readout(l: Lap, d: number): string {
  const t = l.trace;
  const parts = [`${Math.round(at(t, t.v, d))} km/h`, `${Math.abs(at(t, t.lean, d)).toFixed(0)}° ${at(t, t.lean, d) < 0 ? "L" : "R"}`];
  if (t.gear && t.thr && t.brk) {
    parts.push(`gear ${gearName(near(t, t.gear, d))}`, `throttle ${Math.round(at(t, t.thr, d) * 100)}%`,
      `brake ${Math.round(at(t, t.brk, d) * 100)}%${t.rear && near(t, t.rear, d) ? " + rear" : ""}`);
  }
  return parts.join(" · ");
}

function setCursor(d: number | null, e: PointerEvent) {
  const L = full(view.lap);
  if (!L || d == null) { setChartCursor(null); moveMapDot(null); hideTip(); return; }
  setChartCursor(d);
  moveMapDot([at(L.trace, L.trace.x, d), at(L.trace, L.trace.y, d)]);
  const rows = [`<strong>${(d / 1000).toFixed(2)} km</strong>`, `Lap ${L.lap}: ${readout(L, d)}`];
  const C = full(view.cmp);
  if (C) {
    rows.push(`Lap ${C.lap}: ${readout(C, d)}`);
    rows.push(`Gap: ${fmtGap(at(L.trace, L.trace.t, d) - at(C.trace, C.trace.t, d))} s`);
  }
  showTip(rows.join("<br>"), e.clientX, e.clientY);
}

// ---------- track page ----------
function legend(lap: Lap): string {
  const modes: [MapMode, string][] = [["speed", "Speed"]];
  if (lap.trace.thr) modes.push(["inputs", "Throttle & brake"]);
  modes.push(["g", "G-force"]);
  const seg = `<div class="seg" role="group" aria-label="Colour the racing line by">${modes.map(([m, n]) =>
    `<button type="button" data-mode="${m}" aria-pressed="${view.mode === m}">${n}</button>`).join("")}</div>`;
  const pal = palette(view.mode);
  if (view.mode === "speed") {
    const v = lap.trace.v;
    return `${seg}<div class="ramp-legend"><span>${Math.round(Math.min(...v))} km/h</span>
      <span class="ramp" style="background:linear-gradient(90deg,${pal.join(",")})"></span><span>${Math.round(Math.max(...v))} km/h</span></div>`;
  }
  return `${seg}<div class="swatches">${LEGEND[view.mode].map((n, i) => `<span><i style="background:${pal[i]}"></i>${n}</span>`).join("")}</div>`;
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

function renderTrack() {
  const k = view.track!, t = DATA.tracks[k], Li = view.lap, Ci = view.cmp;
  const laps = sorted(lapsOf(k));
  const b = best(k);
  const opt = (l: LapInfo, sel: boolean) => `<option value="${esc(l.id)}" ${sel ? "selected" : ""}>${fmtTime(l.time)} · lap ${l.lap} · ${sessionDate(l.session)}${l.valid ? "" : " · invalid"}</option>`;
  const main = $("#main");
  if (!Li) {
    main.innerHTML = `<header class="page-head"><h2>${esc(t.venue)}</h2><p class="muted">Layout ${esc(t.layout)} · ${(t.length_m / 1000).toFixed(2)} km</p></header>
      <div class="hero"><section class="card map-card">${mapSVG(t, null, view.mode)}
        <p class="muted note">No logged laps here yet: ride with the logger running, then run rta-export.</p></section>
        <div class="tiles">${saveTiles(boardsOf(k), careerOf(k), t.length_m)}</div></div>
      ${boardsHTML(boardsOf(k), t.length_m)}
      ${careerHTML(careerOf(k))}`;
    return;
  }
  for (const l of [Li, Ci]) if (l) fetchTrace(l);
  // Summaries come from the index; the map line and charts wait for the traces.
  const L = full(Li), C = full(Ci);
  const lapStatus = traceStatus(Li, `lap ${Li.lap}`);
  const status = lapStatus || traceStatus(Ci, `lap ${Ci?.lap} to compare`);
  const sp = L ? specs(L, C) : [];
  main.innerHTML = `
    <header class="page-head"><h2>${esc(t.venue)}</h2><p class="muted">Layout ${esc(t.layout)} · ${(t.length_m / 1000).toFixed(2)} km · ${laps.length} logged lap${laps.length === 1 ? "" : "s"}</p></header>
    <div class="hero">
      <section class="card map-card">${mapSVG(t, L, view.mode)}${L ? legend(L) : ""}
        <p class="muted note">${L ? `Racing line for lap ${L.lap}. Hover the map or the charts to scrub through the lap.` : lapStatus}</p></section>
      <div class="tiles">${tiles(Li, k)}</div>
    </div>
    <section class="card">
      <div class="lap-pick">
        <label>Lap <select id="lap-sel">${laps.map((l) => opt(l, l === Li)).join("")}</select></label>
        <label>Compare with <select id="cmp-sel"><option value="">None</option>${laps.filter((l) => l !== Li).map((l) => opt(l, l === Ci)).join("")}</select></label>
      </div>
      ${status ? `<p class="muted note" role="status">${status}</p>` : ""}
      ${L && C ? `<div class="swatches"><span><i class="solid"></i>Lap ${L.lap} · ${fmtTime(L.time)}</span><span><i class="dashed"></i>Lap ${C.lap} · ${fmtTime(C.time)}</span></div>` : ""}
      ${sp.map((s) => `<h4>${s.title}${s.unit ? ` <span class="muted">${s.unit}</span>` : ""}</h4><div class="chart" data-ch="${s.id}"></div>`).join("")}
    </section>
    <section class="card">
      <h3>Logged laps</h3>
      <div class="scroll"><table><thead><tr><th>Lap</th><th>Session</th><th class="r">Time</th><th class="r">Gap</th><th class="r">Top km/h</th><th class="r">Lean L / R</th><th class="r">Full throttle</th><th></th></tr></thead><tbody>
      ${laps.map((l) => `<tr class="${l === Li ? "current" : ""}" data-id="${esc(l.id)}"><td>${l.lap}</td><td>${sessionDate(l.session)}</td><td class="r" title="${l.game_timed ? "Timed by the game" : "Measured at the track spline start (±0.1 s)"}">${fmtTime(l.time)}${l.game_timed ? "" : "<span class=\"approx\">≈</span>"}</td>
        <td class="r">${l.valid && isFinite(b) ? fmtGap(l.time - b) : "–"}</td><td class="r">${Math.round(l.top_speed)}</td>
        <td class="r">${Math.round(-l.max_lean_left)}° / ${Math.round(l.max_lean_right)}°</td><td class="r">${l.full_throttle_pct != null ? Math.round(l.full_throttle_pct) + "%" : "–"}</td>
        <td>${l.valid ? "" : `<span class="pill">${esc(l.problem ?? "invalid")}</span>`}</td></tr>`).join("")}
      </tbody></table></div>
    </section>
    ${boardsHTML(boardsOf(k), t.length_m)}
    ${careerHTML(careerOf(k))}`;
  drawCharts();
  if (L) wireMap($<SVGSVGElement>(".map"), L, setCursor);
  const byId = (id: string) => laps.find((l) => l.id === id) ?? null;
  main.querySelectorAll<HTMLButtonElement>(".seg button").forEach((btn) =>
    btn.addEventListener("click", () => { view.mode = btn.dataset.mode as MapMode; renderTrack(); }));
  $<HTMLSelectElement>("#lap-sel").addEventListener("change", (e) => pick(byId((e.target as HTMLSelectElement).value), view.cmp));
  $<HTMLSelectElement>("#cmp-sel").addEventListener("change", (e) => pick(view.lap, byId((e.target as HTMLSelectElement).value)));
  main.querySelectorAll<HTMLTableRowElement>("tbody tr").forEach((tr) =>
    tr.addEventListener("click", () => pick(byId(tr.dataset.id!), view.cmp)));
}

function drawCharts() {
  const L = full(view.lap), C = full(view.cmp);
  if (!L || !view.track) return;
  const length = DATA.tracks[view.track].length_m;
  const sp = specs(L, C);
  document.querySelectorAll<HTMLElement>(".chart").forEach((el) => {
    const s = sp.find((x) => x.id === el.dataset.ch);
    if (s) drawChart(el, s, L, C, length, setCursor);
  });
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
  addEventListener("resize", () => { clearTimeout(rt); rt = window.setTimeout(drawCharts, 150); });
  // hover text for leaderboard gap bars and career sectors
  document.addEventListener("pointermove", (e) => {
    const el = (e.target as Element).closest<HTMLElement>("[data-tip]");
    if (el) showTip(el.dataset.tip!, e.clientX, e.clientY);
  });
  document.addEventListener("pointerout", (e) => { if ((e.target as Element).closest("[data-tip]")) hideTip(); });

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
    // deep links: ?lap=<id>&cmp=<id>
    const q = new URLSearchParams(location.search), laps = lapsOf(k);
    const find = (id: string | null) => laps.find((l) => l.id === id) ?? null;
    select(k, find(q.get("lap")), find(q.get("cmp")));
  }
  else { renderNav(); $("#main").innerHTML = `<p class="empty">No logged laps yet.</p>`; }
}

boot();
