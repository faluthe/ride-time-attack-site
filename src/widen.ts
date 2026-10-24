// Widening the track on the map: every point's offset from the centreline is multiplied by `k`, so
// the road, and the gaps between close racing lines, grow sideways while distances along the track
// stay put. Only the map uses it; charts and the readout keep the real positions.

import type { Lap, P2, Track } from "./data";

/** The widths offered on the map (1 = true to scale). */
export const WIDTHS = [1, 2, 3, 5];

/** Nearest point on centreline segment `i` (wrapping round the loop) to (x, y), and its distance². */
function onSegment(c: P2[], i: number, x: number, y: number): [number, number, number] {
  const n = c.length, a = c[((i % n) + n) % n], b = c[(((i + 1) % n) + n) % n];
  const dx = b[0] - a[0], dy = b[1] - a[1], len = dx * dx + dy * dy;
  const f = len ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / len)) : 0;
  const px = a[0] + f * dx, py = a[1] + f * dy;
  return [px, py, (x - px) ** 2 + (y - py) ** 2];
}

/** Points pushed `k` times further from the centreline. A lap runs along the track, so after the
 * first point only a few segments either side of the last match are searched. */
function widenPoints(c: P2[], xs: number[], ys: number[], k: number): { x: number[]; y: number[] } {
  const x = new Array<number>(xs.length), y = new Array<number>(ys.length);
  let at = -1;
  for (let j = 0; j < xs.length; j++) {
    let best: [number, number, number] = [xs[j], ys[j], Infinity], bi = 0;
    const [from, to] = at < 0 ? [0, c.length] : [at - 4, at + 12];
    for (let i = from; i < to; i++) {
      const s = onSegment(c, i, xs[j], ys[j]);
      if (s[2] < best[2]) { best = s; bi = i; }
    }
    at = ((bi % c.length) + c.length) % c.length;
    x[j] = best[0] + k * (xs[j] - best[0]);
    y[j] = best[1] + k * (ys[j] - best[1]);
  }
  return { x, y };
}

const tracks = new Map<string, Track>();
const laps = new WeakMap<Lap, Map<number, Lap>>();

/** The track with its edges `k` times further from the centreline. */
export function widenTrack(t: Track, k: number): Track {
  if (k === 1) return t;
  const key = `${t.venue}/${t.layout}/${k}`;
  let w = tracks.get(key);
  if (!w) {
    const edge = (e: P2[]) => e.map((p, i): P2 => [t.centre[i][0] + k * (p[0] - t.centre[i][0]), t.centre[i][1] + k * (p[1] - t.centre[i][1])]);
    w = { ...t, left: edge(t.left), right: edge(t.right) };
    tracks.set(key, w);
  }
  return w;
}

/** The lap with its line moved onto the widened track (cached per lap and width). */
export function widenLap(l: Lap, t: Track, k: number): Lap {
  if (k === 1) return l;
  let m = laps.get(l);
  if (!m) laps.set(l, (m = new Map()));
  let w = m.get(k);
  if (!w) {
    w = { ...l, trace: { ...l.trace, ...widenPoints(t.centre, l.trace.x, l.trace.y, k) } };
    m.set(k, w);
  }
  return w;
}
