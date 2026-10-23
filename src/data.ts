// Data produced by the logger's `rta-export` into public/data/.

export type P2 = [number, number];

export interface Track {
  venue: string;
  layout: string;
  length_m: number;
  centre: P2[];
  left: P2[];
  right: P2[];
}

/** Per-sample channels, all the same length, sampled at ~25 Hz. */
export interface Trace {
  t: number[];
  /** lap distance from the start line, metres */
  d: number[];
  x: number[];
  y: number[];
  /** km/h */
  v: number[];
  /** degrees, right positive */
  lean: number[];
  /** longitudinal g */
  ax: number[];
  // rider inputs: only on sessions recorded since inputs were found
  thr?: number[];
  brk?: number[];
  rear?: number[];
  gear?: number[];
  rpm?: number[];
}

export type Channel = keyof Trace;

export interface Lap {
  id: string;
  session: string;
  lap: number;
  track: string;
  valid: boolean;
  problem: string | null;
  time: number;
  top_speed: number;
  avg_speed: number;
  max_lean_left: number;
  max_lean_right: number;
  max_brake_g: number;
  max_accel_g: number;
  full_throttle_pct?: number;
  braking_pct?: number;
  top_gear?: number;
  trace: Trace;
}

export interface Data {
  tracks: Record<string, Track>;
  laps: Lap[];
}

declare global {
  interface Window {
    RTA_DATA?: Data;
  }
}

/** Data from `data/data.js` if the page loaded it (works from file://), else the JSON files. */
export async function load(): Promise<Data> {
  if (window.RTA_DATA) return window.RTA_DATA;
  const get = async <T>(name: string): Promise<T> => {
    const r = await fetch(`${import.meta.env.BASE_URL}data/${name}`);
    if (!r.ok) throw new Error(`data/${name}: ${r.status}`);
    return r.json() as Promise<T>;
  };
  const [tracks, laps] = await Promise.all([get<Record<string, Track>>("tracks.json"), get<Lap[]>("laps.json")]);
  return { tracks, laps };
}

/** Channel value at lap distance `d` (linear interpolation). */
export function at(tr: Pick<Trace, "d">, values: number[], d: number): number {
  const D = tr.d;
  let lo = 0, hi = D.length - 1;
  if (d <= D[0]) return values[0];
  if (d >= D[hi]) return values[hi];
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (D[m] <= d) lo = m; else hi = m;
  }
  const f = (d - D[lo]) / (D[hi] - D[lo] || 1);
  return values[lo] + f * (values[hi] - values[lo]);
}

/** Value of a discrete channel (gear, rear) at lap distance `d`, without interpolation. */
export function near(tr: Pick<Trace, "d">, values: number[], d: number): number {
  const i = tr.d.findIndex((x) => x >= d);
  return values[i < 0 ? values.length - 1 : Math.max(0, i)];
}
