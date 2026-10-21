import type { Capture } from '../../src/har/types.js';
import type { Expect } from './scenarios.js';

/** One line a lab client wrote before an attempt. */
export interface LedgerEntry {
  sc: string;
  run: number;
  seq: number;
  kind: 'http' | 'ws' | 'tcp' | 'udp';
  path: string;
  port: number;
  bodySha?: string;
  bodyLen?: number;
  /** WebSocket: message index and text. */
  msg?: number;
  text?: string;
  t: number;
  pid?: number;
}

export type Outcome = 'payload' | 'request' | 'host' | 'missed';
export const OUTCOMES: readonly Outcome[] = ['payload', 'request', 'host', 'missed'];
const RANK: Record<Outcome, number> = { payload: 3, request: 2, host: 1, missed: 0 };

/** A destination the tool named without decrypting it. */
export interface Named {
  host: string;
  port?: number;
  protocol?: 'TCP' | 'UDP';
  how: 'refused' | 'passthrough' | 'direct';
}

export interface Observed {
  requests: Capture['requests'];
  named: Named[];
}

export interface LabTarget {
  ip: string;
  host: string;
}

export interface EventScore {
  entry: LedgerEntry;
  outcome: Outcome;
}

export interface RunScore {
  events: EventScore[];
  /** Requests or destinations in the output that no ledger line accounts for. */
  unexpected: string[];
}

/** What whatleaks' own capture metadata names: refused, passthrough and direct destinations. */
export function namedFromCapture(c: Capture): Named[] {
  const m = c.meta;
  if (!m) return [];
  return [
    ...m.refused.map((r): Named => ({ host: r.host, how: 'refused' })),
    ...m.passthrough.map((p): Named => ({ host: p.host, port: p.port, how: 'passthrough' })),
    ...m.direct.map((d): Named => ({ host: d.remote, port: d.port, protocol: d.protocol, how: 'direct' })),
  ];
}

const pathOf = (url: string): string => {
  try {
    return new URL(url).pathname;
  } catch {
    return url.split('?')[0] ?? url;
  }
};

const sha256Hex = async (b: Uint8Array): Promise<string> => {
  const { createHash } = await import('node:crypto');
  return createHash('sha256').update(b).digest('hex');
};

function isNamed(e: LedgerEntry, named: Named[], lab: LabTarget): boolean {
  return named.some((n) => {
    if (n.how === 'direct') {
      const proto = e.kind === 'udp' ? 'UDP' : 'TCP';
      return n.host === lab.ip && n.port === e.port && (n.protocol ?? 'TCP') === proto;
    }
    // A refused or passthrough host names every HTTP(S)/WebSocket attempt to it.
    return (e.kind === 'http' || e.kind === 'ws') && (n.host === lab.host || n.host === lab.ip);
  });
}

/**
 * Score one run: each ledger line gets the best outcome the observation supports.
 * `payload` needs the exact bytes (or, for WebSocket, the message text); `request` means
 * the request is listed but its body is missing or differs; `host` means only the
 * destination is named; `missed` means nothing in the output points to it.
 */
export async function scoreRun(ledger: LedgerEntry[], observed: Observed, lab: LabTarget, runPrefix?: string): Promise<RunScore> {
  const byPath = new Map<string, Capture['requests']>();
  for (const r of observed.requests) {
    const p = pathOf(r.url);
    if (runPrefix && !p.startsWith(runPrefix)) continue;
    byPath.set(p, [...(byPath.get(p) ?? []), r]);
  }
  const shas = new Map<Capture['requests'][number], string>();
  for (const list of byPath.values()) for (const r of list) shas.set(r, await sha256Hex(r.body));

  const events: EventScore[] = ledger.map((entry) => {
    const reqs = entry.kind === 'http' || entry.kind === 'ws' ? (byPath.get(entry.path) ?? []) : [];
    let outcome: Outcome = 'missed';
    for (const r of reqs) {
      let o: Outcome;
      if (entry.kind === 'ws') o = r.websocket?.samples.includes(entry.text ?? '\u0000') ? 'payload' : 'request';
      else o = !r.truncated && !r.bodyIncomplete && shas.get(r) === entry.bodySha ? 'payload' : 'request';
      if (RANK[o] > RANK[outcome]) outcome = o;
    }
    if (outcome === 'missed' && isNamed(entry, observed.named, lab)) outcome = 'host';
    return { entry, outcome };
  });

  const known = new Set(ledger.map((e) => e.path));
  const unexpected: string[] = [];
  for (const [p, list] of byPath) if (!known.has(p)) unexpected.push(`request ${list[0]!.method} ${p}`);
  for (const n of observed.named) {
    if (n.host !== lab.ip && n.host !== lab.host) unexpected.push(`${n.how} ${n.host}${n.port ? `:${n.port}` : ''}`);
  }
  return { events, unexpected };
}

export interface Tally {
  attempted: number;
  payload: number;
  request: number;
  host: number;
  missed: number;
}

export function tally(events: EventScore[]): Tally {
  const t: Tally = { attempted: events.length, payload: 0, request: 0, host: 0, missed: 0 };
  for (const e of events) t[e.outcome]++;
  return t;
}

/** Share of attempts that reached at least the scenario's best possible outcome. */
export function atBest(events: EventScore[], expect: Expect): number {
  if (events.length === 0) return 0;
  return events.filter((e) => RANK[e.outcome] >= RANK[expect]).length / events.length;
}

/** Wilson score interval (95 %) for k successes out of n, as [low, high]. */
export function wilson(k: number, n: number, z = 1.96): [number, number] {
  if (n === 0) return [0, 1];
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const r = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [Math.max(0, (c - r) / d), Math.min(1, (c + r) / d)];
}
