import zlib from 'node:zlib';

/** Never inflate a body past this, so a compression bomb cannot exhaust memory. */
export const MAX_DECODED = 16 * 1024 * 1024;

type Inflate = (buf: Uint8Array, opts: { maxOutputLength: number }) => Buffer;

const DECODERS: Record<string, Inflate | undefined> = {
  gzip: zlib.gunzipSync,
  'x-gzip': zlib.gunzipSync,
  deflate: (b, o) => {
    try {
      return zlib.inflateSync(b, o);
    } catch {
      return zlib.inflateRawSync(b, o); // some clients send raw deflate
    }
  },
  br: zlib.brotliDecompressSync,
  zstd: (zlib as unknown as { zstdDecompressSync?: Inflate }).zstdDecompressSync,
};

/**
 * Undo a Content-Encoding (possibly a list, e.g. `gzip, br`) with an output cap.
 * Returns undefined when the encoding is unknown, invalid, or the result would be too large.
 */
export function decodeContent(raw: Uint8Array, encoding: string, max = MAX_DECODED): Buffer | undefined {
  let out: Uint8Array = raw;
  const layers = encoding
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e && e !== 'identity')
    .reverse();
  for (const layer of layers) {
    const decode = DECODERS[layer];
    if (!decode) return undefined;
    try {
      out = decode(out, { maxOutputLength: max });
    } catch {
      return undefined;
    }
  }
  return Buffer.from(out);
}
