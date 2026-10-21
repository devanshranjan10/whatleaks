import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildMatchers } from '../src/analyze/identity.js';
import { buildReport } from '../src/analyze/report.js';
import { parseHar } from '../src/har/read.js';
import { harText, makeHar } from './helpers/har.js';
import { ANON_ID, FAKE_IDS, TEST_RULES, chattyHar } from './helpers/fixtures.js';

const matchers = buildMatchers(FAKE_IDS);
const report = (raw = false) => buildReport(parseHar(harText(chattyHar())), { matchers, rules: TEST_RULES, raw });

describe('buildReport', () => {
  const r = report();

  it('groups requests into endpoints and destinations', () => {
    expect(r.totals).toMatchObject({ requests: 9, endpoints: 6, destinations: 6 });
    expect(r.endpoints.map((e) => [e.key, e.count, e.classification.category, e.classification.basis])).toEqual([
      ['POST api.segment.io/v1/batch', 3, 'analytics', 'catalog'],
      ['POST o123.ingest.sentry.io/api/:id/envelope/', 1, 'errors', 'catalog'],
      ['POST collector.example.net/v1/traces', 1, 'analytics', 'heuristic'],
      ['POST telemetry.example-tool.dev/v1/events', 1, 'analytics', 'heuristic'],
      ['POST flags.example.com/sdk/evalx/abc', 1, 'flags', 'heuristic'],
      ['GET registry.npmjs.org/left-pad', 2, 'other', 'none'],
    ]);
    // Only catalog hosts count as telemetry; URL guesses are counted separately.
    expect(r.totals.telemetryRequests).toBe(4);
    expect(r.totals.guessedTelemetryRequests).toBe(3);
  });

  it('computes timing and rates', () => {
    const seg = r.endpoints[0]!;
    expect(seg).toMatchObject({ firstMs: 1000, lastMs: 21_000, medianGapMs: 10_000, perMinute: 3 });
    expect(r.capture.durationMs).toBe(60_000);
    expect(r.timeline.reduce((a, b) => a + b, 0)).toBe(9);
  });

  it('inventories fields, flags constants and id-like values', () => {
    const fields = Object.fromEntries(r.endpoints[0]!.fields.map((f) => [f.path, f]));
    expect(fields['batch[].anonymousId']).toMatchObject({ seenIn: 3, constant: true, idLike: true });
    expect(fields['batch[].properties.durationMs']).toMatchObject({ distinct: 3, constant: false });
    expect(fields['batch[].properties.cwd']?.examples).toEqual(['‹home›/projects/app']);
    expect(Object.keys(fields)).not.toContain('header:authorization'.replace('authorization', 'user-agent'));
    expect(r.endpoints[0]!.userAgents).toEqual(['fake-tool/1.2.3 (darwin arm64)']);
    expect(r.endpoints.find((e) => e.host === 'telemetry.example-tool.dev')?.queryParams).toEqual(['machine']);
  });

  it('finds every identifier kind, including hashed and binary forms', () => {
    const byKind = Object.fromEntries(r.findings.map((f) => [f.kind, f]));
    expect(Object.keys(byKind).sort()).toEqual(
      ['email', 'git-email', 'git-name', 'home', 'hostname', 'mac', 'machine-id', 'stable-id', 'username'].sort(),
    );
    expect(byKind.mac).toMatchObject({ forms: ['sha256'], requests: 3, locations: ['batch[].context.device.id'] });
    expect(byKind.username?.forms).toEqual(['md5', 'raw']);
    expect(byKind['machine-id']?.locations).toEqual(['url']);
    expect(byKind['git-name']?.locations).toEqual(['body:strings']);
    expect(byKind.hostname?.locations).toEqual(['body']);
    expect(byKind.email?.requests).toBe(1);
    // High-severity findings come first.
    expect(r.findings.at(-1)?.severity).toBe('medium');
  });

  it('lists repeated identifiers under an alias, with a keyed fingerprint', () => {
    const anon = r.ids.find((x) => x.locations.includes('batch[].anonymousId'));
    expect(anon).toMatchObject({ requests: 3, display: '‹id-1›' });
    expect(anon?.fingerprint).toMatch(/^[0-9a-f]{16}$/);
    // The fingerprint is an HMAC with a per-process key, not a plain hash of the value.
    expect(anon?.fingerprint).not.toBe(createHash('sha256').update(ANON_ID).digest('hex').slice(0, 16));
    expect(r.ids.find((x) => x.locations.includes('batch[].context.device.id'))?.display).toBe('‹sha256(mac)›');
    // Ids seen once are kept too (needed to find ids that persist across runs).
    expect(r.ids.find((x) => x.locations.includes('?machine'))).toMatchObject({ requests: 1, display: '‹machine-id›' });
  });

  it('redacts samples by default and keeps them raw with raw: true', () => {
    const json = JSON.stringify(r);
    for (const secret of ['janedoe', 'jane@doe.dev', 'sk_live', 'janes-mbp', ANON_ID, 'Jane Doe', 'someone@else.org']) {
      expect(json).not.toContain(secret);
    }
    expect(r.endpoints[0]!.samples).toHaveLength(2);
    expect(r.endpoints[0]!.samples[0]!.body).toContain('‹sha256(mac)›');
    const raw = JSON.stringify(report(true));
    expect(raw).toContain('/Users/janedoe/projects/app');
    expect(raw).toContain(ANON_ID);
  });

  it('describes binary bodies with their printable strings', () => {
    const bin = r.endpoints.find((e) => e.host === 'collector.example.net')!;
    expect(bin.samples[0]!.body).toContain('‹binary, ');
    expect(bin.samples[0]!.body).toContain('‹git-name›');
  });

  it('adds caveats for refused hosts, imported HAR, and unfinished requests', () => {
    const har = makeHar(
      [{ at: 0, url: 'https://x.example/a', meta: { aborted: 'ECONNRESET', bodyIncomplete: true } }],
      { refused: [{ host: 'pinned.example', count: 4, cause: 'cert-rejected', firstAt: '', lastAt: '' }], watcher: 'unavailable', notes: ['custom note'] },
    );
    const rr = buildReport(parseHar(harText(har)), { matchers, rules: TEST_RULES });
    expect(rr.caveats).toEqual([
      '4 connections to 1 host did not accept the whatleaks certificate, so their contents are not in this report.',
      'Direct-connection watching was unavailable, so traffic that bypassed the proxy is not listed.',
      '1 request did not complete (aborted, or still in flight when capture stopped).',
      '1 request was cut off before its body finished uploading, so its content is missing.',
      'custom note',
    ]);
    expect(rr.totals.refusedConnections).toBe(4);
    const imported = buildReport(parseHar(harText(makeHar([{ at: 0, url: 'https://x.example/' }], null))), { matchers });
    expect(imported.caveats[0]).toMatch(/^Imported from whatleaks/);
  });

  it('handles an empty capture', () => {
    const empty = buildReport(parseHar(harText(makeHar([]))), { matchers });
    expect(empty.totals.requests).toBe(0);
    expect(empty.endpoints).toEqual([]);
    expect(empty.findings).toEqual([]);
  });

  it('scans every kept WebSocket message for identifiers and fields, not just the shown ones', () => {
    const msgs = Array.from({ length: 6 }, (_, i) => JSON.stringify(i === 4 ? { n: i, user: 'janedoe', home: '/Users/janedoe/x', email: 'jane@doe.dev' } : { n: i }));
    const har = makeHar([{ at: 0, url: 'wss://ws.example/socket', meta: { websocket: { sent: 6, samples: msgs } } }]);
    const r = buildReport(parseHar(harText(har)), { matchers, rules: TEST_RULES });
    expect(r.findings.map((f) => f.kind).sort()).toEqual(expect.arrayContaining(['git-email', 'home', 'username']));
    expect(r.findings.find((f) => f.kind === 'username')?.locations).toEqual(['ws.user']);
    expect(r.endpoints[0]?.fields.map((f) => f.path)).toContain('ws.n');
    // Only the first three are shown; the rest are summarised.
    expect(r.endpoints[0]?.samples[0]?.body).toContain('… 3 more');
  });
});
