// Shared theme tokens (src/theme/tokens.json, synced from ../theme/tokens.json) as CSS variables.
// Styles and charts use roles only: var(--throttle), color("brake"), never raw hex values.

import tokens from "./tokens.json";

export type Mode = "dark" | "light";
type Palette = Record<string, string>;

const modes = tokens.modes as Record<Mode, Palette>;
const STORE = "rta-theme";

function apply(mode: Mode) {
  const root = document.documentElement;
  root.dataset.theme = mode;
  for (const [role, value] of Object.entries(modes[mode])) root.style.setProperty(`--${role}`, value);
  for (const [k, v] of Object.entries(tokens.radius)) root.style.setProperty(`--radius-${k}`, `${v}px`);
  for (const [k, v] of Object.entries(tokens.space)) root.style.setProperty(`--space-${k}`, `${v}px`);
  root.style.setProperty("--font-ui", `"${tokens.font.ui}", system-ui, sans-serif`);
  root.style.setProperty("--font-mono", `"${tokens.font.mono}", ui-monospace, monospace`);
  root.style.setProperty("--font-size", `${tokens.font.size}px`);
  root.style.setProperty("--font-size-small", `${tokens.font["size-small"]}px`);
  root.style.setProperty("--font-size-large", `${tokens.font["size-large"]}px`);
}

function stored(): Mode | null {
  try {
    const m = localStorage.getItem(STORE);
    return m === "dark" || m === "light" ? m : null;
  } catch {
    return null;
  }
}

export function currentMode(): Mode {
  return (document.documentElement.dataset.theme as Mode) || "dark";
}

/** Apply the saved mode, else the OS preference; follow OS changes until the user picks one. */
export function initTheme(onChange?: () => void) {
  const media = matchMedia("(prefers-color-scheme: light)");
  const forced = new URLSearchParams(location.search).get("theme");
  apply(forced === "dark" || forced === "light" ? forced : stored() ?? (media.matches ? "light" : "dark"));
  media.addEventListener("change", () => {
    if (!stored()) { apply(media.matches ? "light" : "dark"); onChange?.(); }
  });
}

export function toggleTheme() {
  const next: Mode = currentMode() === "dark" ? "light" : "dark";
  try { localStorage.setItem(STORE, next); } catch { /* private mode: still switch for this visit */ }
  apply(next);
}

/** Resolved colour for a role in the current mode (for canvas/SVG math that can't use var()). */
export function color(role: string): string {
  return modes[currentMode()][role] ?? "#ff00ff";
}

/** Mix two roles: t = 0 gives `a`, 1 gives `b`. */
export function mix(a: string, b: string, t: number): string {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(color(a)), p(color(b))];
  return "#" + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, "0")).join("");
}
