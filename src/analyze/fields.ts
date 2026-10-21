import type { FieldStat } from '../model.js';

export interface Leaf {
  path: string;
  value: string | number | boolean | null;
}

const MAX_DEPTH = 8;
const MAX_LEAVES = 500;
const MAX_DISTINCT = 51;
const EXAMPLE_LEN = 80;

function joinKey(prefix: string, key: string): string {
  const safe = /^[A-Za-z_$][\w$-]*$/.test(key) ? key : JSON.stringify(key);
  if (prefix === '') return safe;
  return safe.startsWith('"') ? `${prefix}[${safe}]` : `${prefix}.${safe}`;
}

/**
 * Flatten a JSON-ish value into leaves. Arrays collapse to `[]` so that
 * `events[0].name` and `events[7].name` count as the same field.
 */
export function flatten(value: unknown, prefix = ''): Leaf[] {
  const out: Leaf[] = [];
  const walk = (v: unknown, path: string, depth: number): void => {
    if (out.length >= MAX_LEAVES) return;
    if (v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      out.push({ path: path || '$', value: v });
      return;
    }
    if (depth >= MAX_DEPTH) {
      out.push({ path: path || '$', value: '[…]' });
      return;
    }
    if (Array.isArray(v)) {
      for (const item of v) walk(item, `${path}[]`, depth + 1);
      return;
    }
    if (typeof v === 'object') {
      for (const [k, child] of Object.entries(v as Record<string, unknown>)) walk(child, joinKey(path, k), depth + 1);
    }
  };
  walk(value, prefix, 0);
  return out;
}

const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
const HEX_RE = /^[0-9a-f]{16,128}$/i;
const TOKEN_RE = /^[A-Za-z0-9_\-+/=.:]{20,200}$/;

/** Does this value look like an identifier rather than data? */
export function isIdLike(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const v = value.trim();
  if (UUID_RE.test(v) && v.length <= 64) return true;
  if (HEX_RE.test(v)) return true;
  if (!TOKEN_RE.test(v)) return false;
  // Opaque tokens mix letters and digits and are not dates, versions, URLs or paths.
  if (!/\d/.test(v) || !/[A-Za-z]/.test(v)) return false;
  if (/^\d{4}-\d{2}-\d{2}/.test(v) || v.includes('://') || v.startsWith('/') || /^\d+(\.\d+)+/.test(v)) return false;
  return true;
}

function typeOf(v: Leaf['value']): string {
  return v === null ? 'null' : typeof v;
}

function exampleOf(v: Leaf['value']): string {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s.length > EXAMPLE_LEN ? `${s.slice(0, EXAMPLE_LEN - 1)}…` : s;
}

interface Acc {
  seenIn: Set<number>;
  types: Set<string>;
  values: Set<string>;
  examples: string[];
  idLike: boolean;
}

/** Accumulates field statistics across the requests of one endpoint. */
export class FieldAccumulator {
  private readonly fields = new Map<string, Acc>();

  constructor(
    private readonly redactLeaf: (path: string, value: string) => string = (_p, v) => v,
    private readonly redactPath: (path: string) => string = (p) => p,
  ) {}

  add(requestIndex: number, leaves: Leaf[]): void {
    for (const leaf of leaves) {
      let acc = this.fields.get(leaf.path);
      if (!acc) {
        acc = { seenIn: new Set(), types: new Set(), values: new Set(), examples: [], idLike: false };
        this.fields.set(leaf.path, acc);
      }
      acc.seenIn.add(requestIndex);
      acc.types.add(typeOf(leaf.value));
      const key = JSON.stringify(leaf.value);
      if (!acc.values.has(key) && acc.values.size < MAX_DISTINCT) {
        acc.values.add(key);
        if (acc.examples.length < 3) acc.examples.push(exampleOf(typeof leaf.value === 'string' ? this.redactLeaf(leaf.path, leaf.value) : leaf.value));
      }
      if (!acc.idLike && isIdLike(leaf.value)) acc.idLike = true;
    }
  }

  result(): FieldStat[] {
    return [...this.fields.entries()]
      .map(([path, a]) => ({
        path: this.redactPath(path),
        seenIn: a.seenIn.size,
        types: [...a.types].sort(),
        distinct: a.values.size,
        examples: a.examples,
        constant: a.values.size === 1 && a.seenIn.size >= 2,
        idLike: a.idLike,
      }))
      .sort((x, y) => y.seenIn - x.seenIn || x.path.localeCompare(y.path));
  }
}
