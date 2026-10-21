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
      ['POST collector.example.net/v1/traces', 1, 'analytics', 'heuristic'],
      ['POST telemetry.example-tool.dev/v1/events', 1, 'analytics', 'heuristic'],
      ['POST o123.ingest.sentry.io/api/:id/envelope/', 1, 'errors', 'catalog'],
      ['POST flags.example.com/sdk/evalx/abc', 1, 'flags', 'heuristic'],
      ['GET registry.npmjs.org/left-pad', 2, 'other', 'none'],
    ]);
    expect(r.totals.telemetryRequests).toBe(7);
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

  it('lists repeated identifiers with a fingerprint, masked', () => {
    const anon = r.repeatedIds.find((x) => x.display === '0f8f…950e');
    expect(anon).toMatchObject({ requests: 3, locations: ['batch[].anonymousId'] });
    expect(anon?.fingerprint).toMatch(/^[0-9a-f]{12}$/);
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
      [{ at: 0, url: 'https://x.example/a', meta: { aborted: 'ECONNRESET' } }],
      { refused: [{ host: 'pinned.example', count: 4, cause: 'cert-rejected', firstAt: '', lastAt: '' }], watcher: 'unavailable', notes: ['custom note'] },
    );
    const rr = buildReport(parseHar(harText(har)), { matchers, rules: TEST_RULES });
    expect(rr.caveats).toEqual([
      '4 connections to 1 host did not accept the whatleaks certificate, so their contents are not in this report.',
      'Direct-connection watching was unavailable, so traffic that bypassed the proxy is not listed.',
      '1 request did not complete (aborted, or still in flight when capture stopped).',
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
});
