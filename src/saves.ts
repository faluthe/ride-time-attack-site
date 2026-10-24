// Views of the game's own records: offline leaderboards and career results.

import type { CareerResult, Leaderboard } from "./data";
import { esc, fmtTime } from "./format";

/** `Suzuki_GSX-R-1000R-2019` -> `Suzuki GSX R 1000R 2019` */
export function bikeName(key: string): string {
  const [brand, ...rest] = key.split("_");
  return `${brand} ${rest.join(" ").replace(/-(\d{4})$/, " $1").replace(/-/g, " ")}`;
}

/** `STOCK_NS_5` -> `Stock Ns tier 5`. The exact in-game class names aren't mapped yet. */
export function className(cls: string): string {
  return cls.split("_").map((w) => (/^\d+$/.test(w) ? (w === "0" ? "" : `tier ${w}`) : w[0] + w.slice(1).toLowerCase()))
    .filter(Boolean).join(" ");
}

function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return n + s;
}

const kmh = (lengthM: number, t: number) => (lengthM / t) * 3.6;

function gapChart(b: Leaderboard): string {
  const best = b.laps[0].time;
  const max = Math.max(...b.laps.map((l) => l.time - best)) || 1;
  const rows = b.laps.slice(1).map((l) => {
    const g = l.time - best;
    return `<div class="gap-row"><span class="name">${esc(bikeName(l.bike))}</span>
      <div class="gap-track"><div class="gap-bar" style="width:${Math.max(1, (g / max) * 100)}%"
        data-tip="${esc(bikeName(l.bike))}<br>${fmtTime(l.time)} · +${g.toFixed(3)} s"></div></div>
      <span class="v">+${g.toFixed(2)}s</span></div>`;
  }).join("");
  return `<p class="muted gap-title">Gap to ${esc(bikeName(b.laps[0].bike))}</p>${rows}`;
}

export function boardsHTML(boards: Leaderboard[], lengthM: number): string {
  if (!boards.length) return "";
  let html = `<section class="card"><h3>Best laps by class <span class="muted">from your saves</span></h3>`;
  for (const b of boards.slice().sort((x, y) => x.laps[0].time - y.laps[0].time)) {
    const best = b.laps[0].time;
    html += `<div class="cls"><strong>${esc(className(b.class))}</strong><span class="pill">${esc(b.class)}</span></div>
      <div class="scroll"><table><thead><tr>
        <th>Bike</th><th class="r">Lap</th><th class="r">Gap</th><th class="r">Avg km/h</th><th class="r">PP</th><th>Tyres F / R</th><th>Physics</th><th>Surface</th>
      </tr></thead><tbody>${b.laps.map((l, i) => `<tr class="${i === 0 ? "current" : ""}"><td>${esc(bikeName(l.bike))}</td>
        <td class="r">${fmtTime(l.time)}</td><td class="r">${i ? `+${(l.time - best).toFixed(3)}` : "—"}</td>
        <td class="r">${kmh(lengthM, l.time).toFixed(1)}</td><td class="r">${l.pp}</td>
        <td>${l.front || l.rear ? `${esc(l.front ?? "–")} / ${esc(l.rear ?? "–")}` : "Stock"}</td>
        <td>${esc(l.physics)}</td><td>${l.wet ? "Wet" : "Dry"}</td></tr>`).join("")}</tbody></table></div>`;
    if (b.laps.length > 1) html += gapChart(b);
  }
  return html + `</section>`;
}

function sectorBar(e: CareerResult): string {
  // checkpoints are cumulative; the last sector is only known when the result is a lap time
  const cps = e.checkpoints;
  const total = e.metric === "time" ? e.result : null;
  const edges = [0, ...cps, ...(total && total > cps[cps.length - 1] ? [total] : [])];
  const span = edges[edges.length - 1];
  const segs = edges.slice(1).map((at, i) => ({ n: i + 1, dur: at - edges[i], at }));
  const html = segs.map((s) => {
    const role = `series-${((s.n - 1) % 4) + 1}`;
    return `<div class="sector" style="flex:${s.dur} 1 0;background:var(--${role})"
      data-tip="Sector ${s.n}: ${s.dur.toFixed(3)} s<br>split at ${fmtTime(s.at)}">${(s.dur / span) * 100 > 14 ? `<span>${s.dur.toFixed(2)}s</span>` : ""}</div>`;
  }).join("");
  const open = total ? "" : `<div class="sector open" style="flex:${span * 0.12} 1 0" data-tip="Time after the last checkpoint isn't saved for this event type">…</div>`;
  return `<div class="sectors" role="img" aria-label="Sector times: ${segs.map((s) => s.dur.toFixed(2)).join(", ")} seconds">${html}${open}</div>`;
}

export function careerHTML(events: CareerResult[], open = false): string {
  if (!events.length) return "";
  const evs = events.slice().sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
  // career isn't the focus (Time Attack is), so it starts collapsed
  const cleared = evs.filter((e) => e.state === "Cleared").length;
  let html = `<details class="card career"${open ? " open" : ""}><summary><h3>Career events here</h3>
    <span class="muted small">${evs.length} played · ${cleared} cleared</span></summary>`;
  if (evs.some((e) => e.checkpoints.length)) {
    html += `<div class="swatches">${[1, 2, 3, 4].map((i) => `<span><i style="background:var(--series-${i})"></i>Sector ${i}</span>`).join("")}
      <span><i class="hatch"></i>Untimed remainder</span></div>`;
  }
  for (const e of evs) {
    let res: string, goal = "";
    if (e.metric === "time") {
      res = fmtTime(e.result);
      if (e.goal) goal = `<span class="${e.result <= e.goal ? "goal-ok" : ""}">target ${fmtTime(e.goal)}</span>`;
    } else if (e.metric === "overtakes") {
      res = `${e.result} overtakes`;
      if (e.goal) goal = `target ${e.goal}`;
    } else res = `${ordinal(e.result)} place`;
    const cond = [e.weather, e.hour != null ? `${String(e.hour).padStart(2, "0")}:00` : null, e.full_lap === false ? "partial lap" : null].filter(Boolean).join(" · ");
    html += `<div class="event"><div><div class="res">${res}</div>
      <div class="meta">${esc(e.type_label ?? "Event")} · ${esc(e.id)}${goal ? " · " + goal : ""} · ${esc(e.state)}</div>
      <div class="meta">${esc(cond)}</div></div>
      <div>${e.checkpoints.length ? sectorBar(e) : `<span class="muted small">No split times saved</span>`}</div></div>`;
  }
  return html + `</details>`;
}

/** Summary tiles for a layout from the saves alone (used when there are no logged laps). */
export function saveTiles(boards: Leaderboard[], lengthM: number): string {
  const laps = boards.flatMap((b) => b.laps.map((l) => ({ ...l, cls: b.class }))).sort((a, b) => a.time - b.time);
  const best = laps[0];
  const tile = (label: string, value: string, hint = "") =>
    `<div class="tile"><div class="label">${label}</div><div class="value">${value}</div>${hint ? `<div class="hint">${hint}</div>` : ""}</div>`;
  return [
    tile("Best saved lap", best ? fmtTime(best.time) : "–", best ? `${esc(bikeName(best.bike))} · ${esc(className(best.cls))}` : "No offline laps saved here"),
    tile("Average speed", best ? `${kmh(lengthM, best.time).toFixed(1)} km/h` : "–", "Best lap over the mapped length"),
    tile("Track length", `${(lengthM / 1000).toFixed(2)} km`, "From the game's map spline"),
    tile("Bikes timed", String(new Set(laps.map((l) => l.bike)).size || "–"), `${laps.length} saved lap${laps.length === 1 ? "" : "s"}`),  ].join("");
}
