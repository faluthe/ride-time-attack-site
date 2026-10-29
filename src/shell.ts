// What both pages share: the header, the theme, the hover tooltip and the data, grouped by layout.

import "./style.css";
import { initTheme, toggleTheme } from "./theme/theme";
import { load, type CareerResult, type Data, type LapInfo, type Leaderboard } from "./data";
import { esc } from "./format";

export const $ = <T extends Element = HTMLElement>(s: string) => document.querySelector<T>(s)!;

export let DATA: Data = { tracks: {}, laps: [], leaderboards: [], career: [] };
const byTrack = new Map<string, LapInfo[]>();
const boardsBy = new Map<string, Leaderboard[]>();
const careerBy = new Map<string, CareerResult[]>();

export const title = (k: string) => (DATA.tracks[k] ? `${DATA.tracks[k].venue} ${DATA.tracks[k].layout}` : k);
export const lapsOf = (k: string) => byTrack.get(k) ?? [];
export const boardsOf = (k: string) => boardsBy.get(k) ?? [];
export const careerOf = (k: string) => careerBy.get(k) ?? [];
/** Fastest valid logged lap on a layout. */
export const best = (k: string) => Math.min(...lapsOf(k).filter((l) => l.valid).map((l) => l.time));
/** Fastest saved lap on a layout. */
export const bestSaved = (k: string) => Math.min(...boardsOf(k).flatMap((b) => b.laps.map((l) => l.time)));
export const byTitle = (a: string, b: string) => title(a).localeCompare(title(b));
export const lapCount = (n: number) => `${n} lap${n === 1 ? "" : "s"}`;

/** Point the header's page links at layout `k`, so switching pages stays on it. */
export function pageLinks(k: string | null) {
  const h = k ? `#${k}` : "";
  $<HTMLAnchorElement>('.pages [data-page="laps"]').href = `laps.html${h}`;
  $<HTMLAnchorElement>('.pages [data-page="records"]').href = `records.html${h}`;
}

/** The layout named in the address bar's hash, if it's a known one. */
export const hashTrack = () => {
  const k = decodeURIComponent(location.hash.slice(1));
  return DATA.tracks[k] ? k : null;
};

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

/** Theme, header and tooltip, then the data. `redraw` runs when the theme changes; resolves false
 * (with a message in `#main`) if the data couldn't load. */
export async function boot(redraw: () => void): Promise<boolean> {
  initTheme(redraw);
  $("#theme").addEventListener("click", () => { toggleTheme(); redraw(); });
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
    return false;
  }
  for (const l of DATA.laps) byTrack.set(l.track, [...(byTrack.get(l.track) ?? []), l]);
  for (const b of DATA.leaderboards) boardsBy.set(b.track, [...(boardsBy.get(b.track) ?? []), b]);
  for (const c of DATA.career) if (c.track) careerBy.set(c.track, [...(careerBy.get(c.track) ?? []), c]);
  return true;
}
