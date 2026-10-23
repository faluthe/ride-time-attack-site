// Data produced by the logger's `rta-export` into public/data/.

import { decodeLap, gunzipLap, type Channels } from "./lapfile";

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

/** A `laps.json` index entry: everything about a lap except its trace. */
export interface LapInfo {
  id: string;
  session: string;
  lap: number;
  track: string;
  valid: boolean;
  problem: string | null;
  /** `time` is the game's own lap time; otherwise measured between spline-start crossings (±0.1 s) */
  game_timed?: boolean;
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
  /** trace length in samples */
  samples: number;
  /** the trace file, relative to laps.json: `laps/<id>.bin.gz` */
  file: string;
}

/** A lap with its trace loaded. */
export interface Lap extends LapInfo {
  trace: Trace;
}

/** A best lap from the game's offline leaderboards (OfflineLeaderboards.sav). */
export interface BoardLap {
  time: number;
  /** e.g. `Suzuki_GSX-R-1000R-2019` */
  bike: string;
  pp: number;
  front: string | null;
  rear: string | null;
  physics: string;
  wet: boolean;
}

/** Best laps for one layout and bike class, fastest first. */
export interface Leaderboard {
  track: string;
  /** e.g. `STOCK_NS_5` */
  class: string;
  laps: BoardLap[];
}

/** A played career event (PlayerProfile.sav) joined with its definition from the game files. */
export interface CareerResult {
  id: string;
  type?: string;
  type_label?: string;
  /** what `result` measures */
  metric?: "time" | "overtakes" | "position";
  track?: string | null;
  full_lap?: boolean | null;
  weather?: string | null;
  hour?: number | null;
  state: string;
  result: number;
  goal: number;
  /** cumulative split times, seconds */
  checkpoints: number[];
}

export interface Data {
  /** Unix seconds when rta-export ran */
  generated?: number;
  tracks: Record<string, Track>;
  /** the lap index: summaries only, traces are fetched per lap with `loadTrace` */
  laps: LapInfo[];
  leaderboards: Leaderboard[];
  career: CareerResult[];
}

const dataUrl = (path: string) => `${import.meta.env.BASE_URL}data/${path}`;

async function fetchOk(path: string): Promise<Response> {
  const r = await fetch(dataUrl(path));
  if (!r.ok) throw new Error(`data/${path}: ${r.status}`);
  return r;
}

/** The JSON files: tracks, the lap index, leaderboards and career. No traces. */
export async function load(): Promise<Data> {
  const get = async <T>(name: string): Promise<T> => (await fetchOk(name)).json() as Promise<T>;
  const [tracks, index, leaderboards, career] = await Promise.all([
    get<Record<string, Track>>("tracks.json"), get<{ generated?: number; laps: LapInfo[] }>("laps.json"),
    get<Leaderboard[]>("leaderboards.json"), get<CareerResult[]>("career.json"),
  ]);
  return { generated: index.generated, tracks, laps: index.laps, leaderboards, career };
}

const REQUIRED = ["t", "d", "x", "y", "v", "lean", "ax"] as const;
const OPTIONAL = ["thr", "brk", "rear", "gear", "rpm"] as const;

/** Pick the known channels out of a decoded lap file. */
export function toTrace(ch: Channels): Trace {
  for (const k of REQUIRED) if (!ch[k]) throw new Error(`lap file has no ${k} channel`);
  const tr: Trace = { t: ch.t, d: ch.d, x: ch.x, y: ch.y, v: ch.v, lean: ch.lean, ax: ch.ax };
  for (const k of OPTIONAL) if (ch[k]) tr[k] = ch[k];
  return tr;
}

const traces = new Map<string, Promise<Trace>>();

/** A lap's trace, fetched and decoded on first use and then kept in memory. */
export function loadTrace(lap: LapInfo): Promise<Trace> {
  let p = traces.get(lap.id);
  if (!p) {
    p = fetchOk(lap.file)
      .then((r) => r.arrayBuffer())
      .then(gunzipLap)
      .then((buf) => toTrace(decodeLap(buf)));
    // don't cache a failure, so opening the lap again retries
    p.catch(() => traces.delete(lap.id));
    traces.set(lap.id, p);
  }
  return p;
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
