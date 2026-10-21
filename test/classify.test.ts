import { describe, expect, it } from 'vitest';
import { classify, hostMatches } from '../src/analyze/classify.js';
import { TEST_RULES } from './helpers/fixtures.js';

describe('classify', () => {
  it('prefers the catalog and records the vendor', () => {
    expect(classify('api.segment.io', '/v1/batch', TEST_RULES)).toEqual({
      category: 'analytics',
      basis: 'catalog',
      reason: 'Segment (segment.io)',
      vendor: 'Segment',
    });
    expect(classify('o1.ingest.sentry.io', '/api/1/envelope/', TEST_RULES).category).toBe('errors');
  });

  it('falls back to labelled heuristics', () => {
    expect(classify('example.com', '/api/telemetry/v2', TEST_RULES)).toMatchObject({ category: 'analytics', basis: 'heuristic', reason: 'path segment "/telemetry"' });
    expect(classify('telemetry.tool.dev', '/x', TEST_RULES)).toMatchObject({ category: 'analytics', reason: 'host label "telemetry"' });
    expect(classify('x.dev', '/sdk/evalx/abc', TEST_RULES).category).toBe('flags');
    expect(classify('crash.tool.dev', '/upload', TEST_RULES).category).toBe('errors');
    expect(classify('checkpoint-api.hashicorp.com', '/v1/check/terraform', TEST_RULES).category).toBe('updates');
  });

  it('does not match partial words', () => {
    expect(classify('login.example.com', '/logins', TEST_RULES)).toMatchObject({ category: 'other', basis: 'none' });
    expect(classify('registry.npmjs.org', '/left-pad', TEST_RULES).category).toBe('other');
  });

  it('matches hosts by suffix on label boundaries', () => {
    expect(hostMatches('a.b.segment.io', 'segment.io')).toBe(true);
    expect(hostMatches('notsegment.io', 'segment.io')).toBe(false);
  });
});
