import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { type LedgerEntry, atBest, scoreRun, tally, wilson } from '../bench/lab/score.js';
import { parseHar } from '../src/har/read.js';
import { harText, makeHar } from './helpers/har.js';

const lab = { ip: '10.0.0.5', host: '10-0-0-5.sslip.io' };
const sha = (s: string): string => createHash('sha256').update(s).digest('hex');
const http = (seq: number, body: string): LedgerEntry => ({ sc: 's', run: 1, seq, kind: 'http', path: `/e/s/1/${seq}`, port: 4443, bodySha: sha(body), bodyLen: body.length, t: 0 });

describe('bench scorer', () => {
  it('grades payload, request, host and missed', async () => {
    const cap = parseHar(
      harText(
        makeHar([
          { at: 0, url: `https://${lab.host}:4443/e/s/1/0`, body: 'exact' },
          { at: 1, url: `https://${lab.host}:4443/e/s/1/1`, body: 'different' },
        ]),
      ),
    );
    const ledger = [http(0, 'exact'), http(1, 'original'), http(2, 'x'), { ...http(3, ''), kind: 'tcp' as const, port: 7000 }, { ...http(4, ''), kind: 'udp' as const, port: 7001 }];
    const named = [
      { host: lab.ip, port: 7000, protocol: 'TCP' as const, how: 'direct' as const },
      // Same port but TCP: does not name a UDP datagram.
      { host: lab.ip, port: 7001, protocol: 'TCP' as const, how: 'direct' as const },
    ];
    const s = await scoreRun(ledger, { requests: cap.requests, named }, lab);
    expect(s.events.map((e) => e.outcome)).toEqual(['payload', 'request', 'missed', 'host', 'missed']);
    expect(tally(s.events)).toEqual({ attempted: 5, payload: 1, request: 1, host: 1, missed: 2 });
    expect(s.unexpected).toEqual([]);
  });

  it('a refused host names HTTP attempts only; cut-off bodies are never payload', async () => {
    const cap = parseHar(harText(makeHar([{ at: 0, url: `https://${lab.host}:4443/e/s/1/0`, body: 'abc', meta: { truncated: true } }])));
    const ledger = [http(0, 'abc'), http(1, 'b'), { ...http(2, ''), kind: 'tcp' as const }];
    const s = await scoreRun(ledger, { requests: cap.requests, named: [{ host: lab.host, how: 'refused' }] }, lab);
    expect(s.events.map((e) => e.outcome)).toEqual(['request', 'host', 'missed']);
  });

  it('lists output nobody sent as unexpected (false attributions)', async () => {
    const cap = parseHar(harText(makeHar([{ at: 0, url: `https://${lab.host}:4443/e/s/1/9`, body: 'stray' }])));
    const s = await scoreRun([http(0, 'a')], { requests: cap.requests, named: [{ host: '1.2.3.4', port: 443, how: 'direct' }] }, lab);
    expect(s.unexpected).toEqual(['request POST /e/s/1/9', 'direct 1.2.3.4:443']);
  });

  it('matches WebSocket messages by text', async () => {
    const cap = parseHar(harText(makeHar([{ at: 0, url: `wss://${lab.host}:4443/e/s/1/0`, meta: { websocket: { sent: 2, samples: ['m0'] } } }])));
    const ws = (msg: number, text: string): LedgerEntry => ({ ...http(0, text), kind: 'ws', msg, text });
    const s = await scoreRun([ws(0, 'm0'), ws(1, 'm1')], { requests: cap.requests, named: [] }, lab);
    expect(s.events.map((e) => e.outcome)).toEqual(['payload', 'request']);
  });

  it('only counts requests under the run prefix when one is given', async () => {
    const cap = parseHar(harText(makeHar([{ at: 0, url: `https://${lab.host}:4443/e/s/2/0`, body: 'a' }])));
    const s = await scoreRun([http(0, 'a')], { requests: cap.requests, named: [] }, lab, '/e/s/1/');
    expect(s.events[0]?.outcome).toBe('missed');
    expect(s.unexpected).toEqual([]);
  });

  it('at-best share and Wilson interval', () => {
    const ev = (o: 'payload' | 'host' | 'missed') => ({ entry: http(0, ''), outcome: o });
    expect(atBest([ev('payload'), ev('host'), ev('missed'), ev('host')], 'host')).toBe(0.75);
    expect(atBest([ev('payload'), ev('host')], 'payload')).toBe(0.5);
    const [lo, hi] = wilson(10, 10);
    expect(hi).toBe(1);
    expect(lo).toBeCloseTo(0.722, 3);
    expect(wilson(0, 0)).toEqual([0, 1]);
  });
});
