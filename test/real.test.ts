import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildReport } from '../src/analyze/report.js';
import { buildDiff, stillSendsTelemetry } from '../src/diff/diff.js';
import { parseHar } from '../src/har/read.js';
import { renderDiffTerminal } from '../src/render/diff.js';

// Scrubbed recordings of real `next build` runs (Next.js 16.4.2, Node 22.23.3, 2026-10-21).
// See docs/e2e/README.md for how they were made.
const load = (name: string) =>
  buildReport(parseHar(readFileSync(new URL(`fixtures/real/${name}`, import.meta.url), 'utf8')), { matchers: [] });

const def = load('next-16.4.2-default.har');
const dnt = load('next-16.4.2-do-not-track.har');
const all = load('next-16.4.2-all-opt-outs.har');

describe('real capture: next build with defaults', () => {
  it('finds the telemetry endpoint from the catalog and the npm advisory check', () => {
    expect(def.endpoints.map((e) => [e.key, e.count, e.classification.basis])).toEqual([
      ['POST telemetry.nextjs.org/api/v1/record', 8, 'catalog'],
      ['POST registry.npmjs.org/-/npm/v1/security/advisories/bulk', 1, 'none'],
    ]);
    expect(def.totals.telemetryRequests).toBe(8);
  });

  it('sees all 7 event names that NEXT_TELEMETRY_DEBUG printed for the same build', () => {
    const names = def.endpoints[0]!.fields.find((f) => f.path === 'events[].eventName');
    expect(names?.distinct).toBe(7);
    expect(names?.seenIn).toBe(8);
  });

  it('flags the three ids repeated across requests and nothing identifying', () => {
    expect(def.ids.filter((i) => i.requests === 8).flatMap((i) => i.locations).sort()).toEqual([
      'context.anonymousId',
      'context.projectId',
      'context.sessionId',
    ]);
    expect(def.findings.map((f) => f.kind)).toEqual(['stable-id']);
  });
});

describe('real captures: opting out', () => {
  it('DO_NOT_TRACK=1 does not stop Next.js telemetry, and two ids persist across runs', () => {
    const d = buildDiff(def, dnt);
    expect(d.endpoints[0]).toMatchObject({ key: 'POST telemetry.nextjs.org/api/v1/record', status: 'still', before: { count: 8 }, after: { count: 8 } });
    expect(stillSendsTelemetry(d)).toBe(true);
    expect(d.persistentIds.flatMap((p) => p.locations).sort()).toEqual(['context.anonymousId', 'context.projectId']);
    expect(renderDiffTerminal(d)).toContain('The telemetry endpoint was still contacted after opting out.');
  });

  it('the documented opt-outs stop it; the advisory check remains', () => {
    const d = buildDiff(def, all);
    expect(d.endpoints.map((e) => [e.key, e.status])).toEqual([
      ['POST registry.npmjs.org/-/npm/v1/security/advisories/bulk', 'still'],
      ['POST telemetry.nextjs.org/api/v1/record', 'stopped'],
    ]);
    expect(stillSendsTelemetry(d)).toBe(false);
    expect(all.capture.optOutEnv).toContain('NEXT_TELEMETRY_DISABLED');
  });
});
