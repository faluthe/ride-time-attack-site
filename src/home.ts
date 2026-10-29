// The landing page: a banner with the latest venue's photo and the totals, then a card for every
// layout with logged laps (venue photo, the layout's outline, best lap), each opening its laps.

import { photoUrl, type LapInfo, type Track } from "./data";
import { esc, fmtTime, sessionDate } from "./format";
import { $, DATA, best, boot, byTitle, lapCount, lapsOf, title } from "./shell";

// The laps view used to live here: send its old links (`/#kanto_c`, `/?lap=…#kanto_c`) on to it.
if (location.hash.length > 1) location.replace(`laps.html${location.search}${location.hash}`);

/** The layout's centreline as a closed outline, fitted to its own box. */
function outlineSVG(t: Track): string {
  const xs = t.centre.map((p) => p[0]), ys = t.centre.map((p) => p[1]);
  const x0 = Math.min(...xs), y0 = Math.min(...ys);
  const w = Math.max(...xs) - x0, h = Math.max(...ys) - y0;
  const pts = t.centre.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  return `<svg class="outline" viewBox="${x0} ${y0} ${w} ${h}" aria-hidden="true">
    <polygon class="outline-halo" points="${pts}"/><polygon class="outline-line" points="${pts}"/></svg>`;
}

function cardHTML(k: string): string {
  const t = DATA.tracks[k], b = best(k);
  return `<li><a class="track-card" href="laps.html#${esc(k)}">
    <div class="track-photo">
      <img src="${photoUrl(k, "card")}" alt="" loading="lazy" decoding="async">
      ${outlineSVG(t)}
    </div>
    <div class="track-info">
      <h3>${esc(t.venue)}</h3>
      <p><span class="t">${isFinite(b) ? fmtTime(b) : "no valid lap"}</span><span class="muted">Layout ${esc(t.layout)} · ${lapCount(lapsOf(k).length)}</span></p>
    </div>
  </a></li>`;
}

function bannerHTML(latest: LapInfo, layouts: number): string {
  const stat = (n: number | string, label: string) => `<div><dt>${label}</dt><dd>${n}</dd></div>`;
  return `<section class="hero">
    <img class="hero-photo" src="${photoUrl(latest.track, "full")}" alt="" fetchpriority="high">
    <div class="hero-text">
      <h2>Ride Time Attack</h2>
      <dl class="hero-stats">
        ${stat(DATA.laps.length, "Laps")}${stat(layouts, "Layouts")}
        ${stat(`<a href="laps.html#${esc(latest.track)}">${esc(title(latest.track))}</a>`, `Latest · ${sessionDate(latest.session).slice(0, 10)}`)}
      </dl>
    </div>
  </section>`;
}

async function start() {
  if (!(await boot(() => {}))) return;
  const keys = Object.keys(DATA.tracks).filter((k) => lapsOf(k).length).sort(byTitle);
  // session ids are timestamps, so the newest sorts last
  const latest = DATA.laps.reduce<LapInfo | null>((a, l) => (!a || l.session > a.session ? l : a), null);
  if (!latest) {
    $("#main").innerHTML = `<p class="empty">No logged laps yet. The game's saved times are under <a href="records.html">Records</a>.</p>`;
    return;
  }
  $("#main").innerHTML = `${bannerHTML(latest, keys.length)}
    <section aria-label="Tracks"><ul class="track-grid">${keys.map(cardHTML).join("")}</ul></section>`;
  // a venue without a photo keeps the plain backdrop
  $("#main").addEventListener("error", (e) => (e.target as Element).closest(".track-photo img, .hero-photo")?.remove(), true);
}

start();
