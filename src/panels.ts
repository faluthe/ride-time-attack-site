// The playback view's panels, toggled from the toolbar and remembered per viewer: graphs in the
// column beside the map, and widgets floating over it (dragged by their title bar). The names
// match the logger's panel toggles.

export const GRAPHS = ["speed", "lean", "inputs", "gear", "rpm", "g", "delta"] as const;
export const WIDGETS = ["readout", "timer", "tach", "rider", "tiles"] as const;
export const PANELS = [...GRAPHS, ...WIDGETS] as const;
export type Graph = (typeof GRAPHS)[number];
export type Widget = (typeof WIDGETS)[number];
export type Panel = Graph | Widget;

export const PANEL_LABEL: Record<Panel, string> = {
  speed: "Speed", lean: "Lean", inputs: "Inputs", gear: "Gear", rpm: "RPM", g: "G", delta: "Delta",
  readout: "Readout", timer: "Timer", tach: "Tach", rider: "Rider", tiles: "Tiles",
};

/** Off until switched on: the rest start on. */
const DEFAULT_OFF: Panel[] = ["tiles"];

/** Where each widget starts, as a share of the free space across and down (0 = left / top edge,
 * 1 = right / bottom edge), so a widget stays in the same corner when the map changes size. */
const DEFAULT_POS: Record<Widget, Pos> = {
  readout: { x: 0, y: 0 }, timer: { x: 1, y: 0 }, tach: { x: 1, y: 1 }, rider: { x: 0, y: 1 }, tiles: { x: 0.5, y: 1 },
};

export interface Pos { x: number; y: number }

interface Saved {
  /** only the panels the viewer switched, so new panels get their default */
  on: Partial<Record<Panel, boolean>>;
  pos: Partial<Record<Widget, Pos>>;
  /** the graph column's share of the stage's width */
  side?: number;
  /** how many times wider than life the map draws the track */
  width?: number;
}

const STORE = "rta-layout";

function load(): Saved {
  try {
    const v = JSON.parse(localStorage.getItem(STORE) ?? "{}");
    return { on: v.on ?? {}, pos: v.pos ?? {}, side: typeof v.side === "number" ? v.side : undefined, width: typeof v.width === "number" ? v.width : undefined };
  } catch {
    return { on: {}, pos: {} };
  }
}

const saved = load();

function save() {
  try { localStorage.setItem(STORE, JSON.stringify(saved)); } catch { /* private mode: still works for this visit */ }
}

export const panelOn = (p: Panel) => saved.on[p] ?? !DEFAULT_OFF.includes(p);
export function togglePanel(p: Panel) { saved.on[p] = !panelOn(p); save(); }

export const widgetPos = (w: Widget): Pos => saved.pos[w] ?? DEFAULT_POS[w];
export function setWidgetPos(w: Widget, p: Pos) { saved.pos[w] = p; save(); }

export const SIDE = { min: 0.18, max: 0.6, initial: 0.3 };
export const sideShare = () => Math.min(SIDE.max, Math.max(SIDE.min, saved.side ?? SIDE.initial));
export function setSideShare(s: number) { saved.side = Math.min(SIDE.max, Math.max(SIDE.min, s)); save(); }

/** Starts at 2×: wide enough to tell close lines apart without folding the tighter hairpins over. */
export const mapWidth = () => saved.width ?? 2;
export function setMapWidth(w: number) { saved.width = w; save(); }
