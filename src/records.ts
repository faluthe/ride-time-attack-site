// The records page: the game's own records per layout, read from the saves. Best laps by bike
// class from the offline leaderboards, then career results (collapsed: Time Attack comes first).

import { esc, fmtTime } from "./format";
import { boardsHTML, careerHTML, saveTiles } from "./saves";
import { $, DATA, boardsOf, boot, bestSaved, byTitle, careerOf, hashTrack, lapCount, lapsOf, pageLinks, title } from "./shell";

let track: string | null = null;
/** Whether the collapsed career section is open, kept across re-renders. */
let careerOpen = false;

/** Saved records: leaderboards or career results. */
const hasData = (k: string) => boardsOf(k).length + careerOf(k).length > 0;

function renderNav() {
  const q = $<HTMLInputElement>("#search").value.trim().toLowerCase();
  const all = $<HTMLInputElement>("#show-all").checked;
  const keys = Object.keys(DATA.tracks)
    .filter((k) => all || hasData(k))
    .filter((k) => !q || title(k).toLowerCase().includes(q))
    .sort(byTitle);
  let html = "", venue = "";
  for (const k of keys) {
    const t = DATA.tracks[k], b = bestSaved(k);
    if (t.venue !== venue) { html += `<li class="venue">${esc(t.venue)}</li>`; venue = t.venue; }
    html += `<li><button class="track-btn${hasData(k) ? "" : " none"}" data-k="${k}" aria-current="${k === track}">
      <span>Layout ${esc(t.layout)}</span><span class="t">${isFinite(b) ? fmtTime(b) : ""}</span></button></li>`;
  }
  $("#track-list").innerHTML = html || `<li class="muted">No tracks match</li>`;
  $<HTMLSelectElement>("#track-select").innerHTML = keys.map((k) =>
    `<option value="${k}" ${k === track ? "selected" : ""}>${esc(title(k))}</option>`).join("");
}

function select(k: string) {
  track = k;
  pageLinks(k);
  history.replaceState(null, "", `#${k}`);
  renderNav();
  render();
}

function render() {
  if (!track) return;
  const k = track, t = DATA.tracks[k], n = lapsOf(k).length;
  const boards = boardsOf(k), career = careerOf(k);
  $("#main").innerHTML = `
    <header class="page-head"><h2>${esc(t.venue)}</h2><p class="muted">Layout ${esc(t.layout)} · ${(t.length_m / 1000).toFixed(2)} km${n
      ? ` · <a href="./#${esc(k)}">${lapCount(n)} logged</a>` : ""}</p></header>
    <div class="tiles wide">${saveTiles(boards, t.length_m)}</div>
    ${boards.length ? boardsHTML(boards, t.length_m) : `<p class="muted note">No offline Time Attack laps saved on this layout.</p>`}
    ${careerHTML(career, careerOpen)}`;
}

async function start() {
  $("#search").addEventListener("input", renderNav);
  $("#show-all").addEventListener("change", renderNav);
  $("#track-list").addEventListener("click", (e) => {
    const b = (e.target as Element).closest<HTMLButtonElement>(".track-btn");
    if (b) select(b.dataset.k!);
  });
  $("#track-select").addEventListener("change", (e) => select((e.target as HTMLSelectElement).value));
  // `toggle` doesn't bubble, so listen in the capture phase
  document.addEventListener("toggle", (e) => {
    const el = e.target as Element;
    if (el.matches("details.career")) careerOpen = (el as HTMLDetailsElement).open;
  }, true);
  addEventListener("hashchange", () => { const k = hashTrack(); if (k && k !== track) select(k); });

  if (!(await boot(render))) return;
  // the layout from the laps page if it has records, else the first one that does
  const want = hashTrack();
  const k = want ?? Object.keys(DATA.tracks).filter(hasData).sort(byTitle)[0];
  if (want && !hasData(want)) $<HTMLInputElement>("#show-all").checked = true;
  if (k) select(k);
  else { renderNav(); $("#main").innerHTML = `<p class="empty">No saved records yet: run rta-export with the game's saves available.</p>`; }
}

start();
