// The playback view's panels, toggled from the header's Panels menu and remembered per viewer:
// graphs and widgets, all floating over the map (dragged by their title bar; graphs also resize
// from their corner). The names match the logger's panel toggles.

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

/** Off until switched on: the rest start on. Two graphs to start with, so the map stays clear. */
const DEFAULT_OFF: Panel[] = ["lean", "gear", "rpm", "g", "delta", "tiles"];

/** Where each panel starts, as a share of the free space across and down (0 = left / top edge,
 * 1 = right / bottom edge), so a panel stays in the same corner when the map changes size. The
 * widgets take the corners (the timer halfway down, out from under the Panels menu, which opens
 * over the top right corner), the graphs the middles of the edges and the centre. */
const DEFAULT_POS: Record<Panel, Pos> = {
  readout: { x: 0, y: 0 }, timer: { x: 1, y: 0.5 }, tach: { x: 1, y: 1 }, rider: { x: 0, y: 1 }, tiles: { x: 0.5, y: 1 },
  speed: { x: 0.5, y: 0 }, inputs: { x: 0.5, y: 1 }, lean: { x: 0, y: 0.5 }, gear: { x: 0.75, y: 0.5 },
  rpm: { x: 0.5, y: 0.5 }, g: { x: 0.5, y: 0.3 }, delta: { x: 0.5, y: 0.7 },
};

export interface Pos { x: number; y: number }
/** A graph's size in pixels, once resized. */
export interface Size { w: number; h: number }

interface Saved {
  /** only the panels the viewer switched, so new panels get their default */
  on: Partial<Record<Panel, boolean>>;
  pos: Partial<Record<Panel, Pos>>;
  size: Partial<Record<Panel, Size>>;
  /** how many times wider than life the map draws the track */
  width?: number;
}

const STORE = "rta-layout";

function load(): Saved {
  try {
    const v = JSON.parse(localStorage.getItem(STORE) ?? "{}");
    return { on: v.on ?? {}, pos: v.pos ?? {}, size: v.size ?? {}, width: typeof v.width === "number" ? v.width : undefined };
  } catch {
    return { on: {}, pos: {}, size: {} };
  }
}

const saved = load();

function save() {
  try { localStorage.setItem(STORE, JSON.stringify(saved)); } catch { /* private mode: still works for this visit */ }
}

export const panelOn = (p: Panel) => saved.on[p] ?? !DEFAULT_OFF.includes(p);
export function togglePanel(p: Panel) { saved.on[p] = !panelOn(p); save(); }

export const panelPos = (p: Panel): Pos => saved.pos[p] ?? DEFAULT_POS[p];
export function setPanelPos(p: Panel, at: Pos) { saved.pos[p] = at; save(); }

export const panelSize = (p: Panel): Size | undefined => saved.size[p];
export function setPanelSize(p: Panel, s: Size) { saved.size[p] = s; save(); }

/** Starts at 2×: wide enough to tell close lines apart without folding the tighter hairpins over. */
export const mapWidth = () => saved.width ?? 2;
export function setMapWidth(w: number) { saved.width = w; save(); }
