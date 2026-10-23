export function fmtTime(s: number | null | undefined): string {
  if (s == null || !isFinite(s)) return "–";
  const m = Math.floor(s / 60), r = s - m * 60;
  return m ? `${m}:${r.toFixed(3).padStart(6, "0")}` : r.toFixed(3);
}

export const fmtGap = (s: number) => (s === 0 ? "—" : `${s > 0 ? "+" : ""}${s.toFixed(3)}`);

/** `20261022-203625` -> `2026-10-22 20:36` */
export function sessionDate(id: string): string {
  const m = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})/.exec(id);
  return m ? `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}` : id;
}

export function esc(s: unknown): string {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

export const gearName = (g: number) => (Math.round(g) ? String(Math.round(g)) : "N");
