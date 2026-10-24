// Decoder for the logger's per-lap trace files (`laps/<id>.bin.gz`, see "Lap files" in the logger
// README). No dependencies, so it runs in the browser and under Node alike.

/** Decoded channels by name, e.g. `t`, `d`, `lean`. Unknown names are kept too; callers pick. */
export type Channels = Record<string, number[]>;

const MAGIC = 0x4c415452; // "RTAL" read as a little-endian u32
/** Newest version understood; 2 added `z` and `hdg`, so version 1 traces just lack them. */
const VERSION = 2;

/** Gunzip `bytes` unless they're already a raw trace (a server undid the gzip). */
export async function gunzipLap(bytes: ArrayBuffer): Promise<ArrayBuffer> {
  const head = new Uint8Array(bytes, 0, Math.min(4, bytes.byteLength));
  if (head.length === 4 && new DataView(bytes).getUint32(0, true) === MAGIC) return bytes;
  if (head[0] !== 0x1f || head[1] !== 0x8b) throw new Error("not a lap file");
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).arrayBuffer();
}

/** Decode a raw (already gunzipped) lap trace. */
export function decodeLap(buf: ArrayBuffer): Channels {
  const dv = new DataView(buf);
  if (buf.byteLength < 12 || dv.getUint32(0, true) !== MAGIC) throw new Error("bad lap file magic");
  const version = dv.getUint16(4, true);
  if (version < 1 || version > VERSION) throw new Error(`unsupported lap file version ${version}`);
  const C = dv.getUint16(6, true);
  const N = dv.getUint32(8, true);
  let off = 12 + 12 * C;
  if (buf.byteLength < off) throw new Error("truncated lap file");

  const out: Channels = {};
  for (let c = 0; c < C; c++) {
    const e = 12 + 12 * c;
    let name = "";
    for (let i = 0; i < 4; i++) {
      const ch = dv.getUint8(e + i);
      if (!ch) break;
      name += String.fromCharCode(ch);
    }
    const W = dv.getUint8(e + 4);
    const scale = 10 ** dv.getUint8(e + 5);
    const first = dv.getInt32(e + 8, true);
    if (W !== 1 && W !== 2 && W !== 4) throw new Error(`channel ${name}: bad delta width ${W}`);
    const deltas = N > 0 ? N - 1 : 0;
    const len = Math.ceil((deltas * W) / 4) * 4;
    if (off + len > buf.byteLength) throw new Error(`channel ${name}: truncated`);

    const values = new Array<number>(N);
    if (N > 0) {
      // typed-array views use the host byte order; every browser platform is little-endian
      const d = W === 1 ? new Int8Array(buf, off, deltas) : W === 2 ? new Int16Array(buf, off, deltas) : new Int32Array(buf, off, deltas);
      let q = first;
      values[0] = q / scale;
      for (let i = 0; i < deltas; i++) {
        q = (q + d[i]) | 0;
        values[i + 1] = q / scale;
      }
    }
    out[name] = values;
    off += len;
  }
  return out;
}
