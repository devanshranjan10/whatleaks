import { gunzipSync, inflateSync } from 'node:zlib';
import * as zlib from 'node:zlib';

export type BodyFormat = 'empty' | 'json' | 'ndjson' | 'form' | 'text' | 'binary';

export interface DecodedBody {
  format: BodyFormat;
  /** Decoded size in bytes. */
  size: number;
  /** UTF-8 text for every non-binary format. */
  text?: string;
  /** Parsed value: the JSON value, an array of NDJSON values, or a form object. */
  value?: unknown;
  /** Printable runs from a binary body (for protobuf and similar). */
  strings?: string[];
  /** The body was compressed without a content-encoding header and was inflated here. */
  inflated?: 'gzip' | 'zlib' | 'zstd';
}

const MIN_STRING_RUN = 6;
const MAX_STRINGS = 60;
const utf8 = new TextDecoder('utf-8', { fatal: true });

type ZstdSync = (buf: Uint8Array) => Buffer;
const zstdDecompressSync = (zlib as unknown as { zstdDecompressSync?: ZstdSync }).zstdDecompressSync;

/** Inflate bodies that are still compressed (the producer did not decode them). */
function inflate(bytes: Uint8Array): { bytes: Uint8Array; how?: DecodedBody['inflated'] } {
  try {
    if (bytes[0] === 0x1f && bytes[1] === 0x8b) return { bytes: gunzipSync(bytes), how: 'gzip' };
    if (bytes[0] === 0x28 && bytes[1] === 0xb5 && bytes[2] === 0x2f && bytes[3] === 0xfd && zstdDecompressSync) {
      return { bytes: zstdDecompressSync(bytes), how: 'zstd' };
    }
    // zlib header: CMF 0x78 with a valid FCHECK.
    if (bytes[0] === 0x78 && bytes.length > 2 && ((bytes[0] << 8) | bytes[1]!) % 31 === 0) {
      return { bytes: inflateSync(bytes), how: 'zlib' };
    }
  } catch {
    // Not actually compressed; fall through and treat as-is.
  }
  return { bytes };
}

function asText(bytes: Uint8Array): string | undefined {
  let text: string;
  try {
    text = utf8.decode(bytes);
  } catch {
    return undefined;
  }
  // Mostly-control-character payloads are binary even if they happen to be valid UTF-8.
  let control = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d) control++;
  }
  return control > Math.max(2, text.length * 0.05) ? undefined : text;
}

function tryJson(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

function tryNdjson(text: string): unknown[] | undefined {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length < 2) return undefined;
  const values: unknown[] = [];
  for (const line of lines) {
    const parsed = tryJson(line);
    if (!parsed.ok || typeof parsed.value !== 'object' || parsed.value === null) return undefined;
    values.push(parsed.value);
  }
  return values;
}

const FORM_RE = /^[\w.%[\]+-]+=[^&=]*(?:&[\w.%[\]+-]+=[^&=]*)*$/;

function parseForm(text: string): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const [k, v] of new URLSearchParams(text)) {
    const prev = out[k];
    if (prev === undefined) out[k] = v;
    else out[k] = Array.isArray(prev) ? [...prev, v] : [prev, v];
  }
  // Form fields often carry JSON (e.g. `data={"event":...}`); expand those.
  for (const [k, v] of Object.entries(out)) {
    if (typeof v === 'string' && /^\s*[[{]/.test(v)) {
      const parsed = tryJson(v);
      if (parsed.ok) (out as Record<string, unknown>)[k] = parsed.value;
    }
  }
  return out;
}

export function extractStrings(bytes: Uint8Array): string[] {
  const out: string[] = [];
  let run = '';
  const flush = (): void => {
    if (run.length >= MIN_STRING_RUN && out.length < MAX_STRINGS) out.push(run);
    run = '';
  };
  for (const b of bytes) {
    if (b >= 0x20 && b < 0x7f) run += String.fromCharCode(b);
    else flush();
  }
  flush();
  return out;
}

/** Decode a request body into something a person can read. Never throws. */
export function decodeBody(raw: Uint8Array, contentType = ''): DecodedBody {
  if (raw.length === 0) return { format: 'empty', size: 0 };
  const { bytes, how } = inflate(raw);
  const base = { size: bytes.length, ...(how ? { inflated: how } : {}) };
  const text = asText(bytes);
  if (text === undefined) return { format: 'binary', ...base, strings: extractStrings(bytes) };

  const ct = contentType.toLowerCase();
  const trimmed = text.trim();
  if (ct.includes('json') || /^[[{]/.test(trimmed)) {
    const parsed = tryJson(trimmed);
    if (parsed.ok) return { format: 'json', ...base, text, value: parsed.value };
    const nd = tryNdjson(text);
    if (nd) return { format: 'ndjson', ...base, text, value: nd };
  }
  if (ct.includes('x-www-form-urlencoded') || (!ct.includes('multipart') && FORM_RE.test(trimmed))) {
    return { format: 'form', ...base, text, value: parseForm(trimmed) };
  }
  return { format: 'text', ...base, text };
}
