// The playback view's panels, toggled from the toolbar and remembered per viewer. The names match
// the logger's panel toggles: one per chart, plus the readout and the lap tiles.

export const PANELS = ["speed", "lean", "inputs", "gear", "rpm", "g", "delta", "readout", "tiles"] as const;
export type Panel = (typeof PANELS)[number];

export const PANEL_LABEL: Record<Panel, string> = {
  speed: "Speed", lean: "Lean", inputs: "Inputs", gear: "Gear", rpm: "RPM", g: "G", delta: "Delta",
  readout: "Readout", tiles: "Tiles",
};

const STORE = "rta-panels";

/** The panels switched off. Stored rather than the ones on, so panels added later start on. */
function load(): Set<Panel> {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(STORE) ?? "[]");
    return new Set(Array.isArray(v) ? v.filter((p): p is Panel => PANELS.includes(p)) : []);
  } catch {
    return new Set();
  }
}

const off = load();

export const panelOn = (p: Panel) => !off.has(p);

export function togglePanel(p: Panel) {
  if (off.has(p)) off.delete(p); else off.add(p);
  try { localStorage.setItem(STORE, JSON.stringify([...off])); } catch { /* private mode: still toggles for this visit */ }
}
