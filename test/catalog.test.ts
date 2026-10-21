import { describe, expect, it } from 'vitest';
import { classify } from '../src/analyze/classify.js';
import { HOST_RULES } from '../src/catalog/hosts.js';

describe('host catalog', () => {
  it('has a public https source, a valid host and no duplicates', () => {
    const seen = new Set<string>();
    for (const r of HOST_RULES) {
      expect(r.source, r.host).toMatch(/^https:\/\/[^\s]+$/);
      expect(r.host, r.host).toMatch(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/);
      if (r.path) expect(r.path.startsWith('/'), r.host).toBe(true);
      const key = `${r.host}${r.path ?? ''}`;
      expect(seen.has(key), key).toBe(false);
      seen.add(key);
    }
    expect(HOST_RULES.length).toBeGreaterThan(50);
  });

  it.each([
    ['telemetry.nextjs.org', '/api/v1/record', 'analytics', 'Next.js telemetry'],
    ['o4504.ingest.de.sentry.io', '/api/1/envelope/', 'errors', 'Sentry'],
    ['mobile.events.data.microsoft.com', '/OneCollector/1.0', 'analytics', 'Microsoft 1DS telemetry'],
    ['southcentralus-0.in.applicationinsights.azure.com', '/v2/track', 'analytics', 'Azure Application Insights'],
    ['checkpoint-api.hashicorp.com', '/v1/check/terraform', 'updates', 'HashiCorp Checkpoint version check'],
    ['checkpoint-api.hashicorp.com', '/v1/telemetry/packer', 'analytics', 'HashiCorp Checkpoint telemetry'],
    ['us.i.posthog.com', '/i/v0/e/', 'analytics', 'PostHog'],
    ['browser-http-intake.logs.datadoghq.eu', '/v1/input/x', 'analytics', 'Datadog'],
  ])('%s%s → %s (%s)', (host, path, category, vendor) => {
    expect(classify(host, path)).toMatchObject({ category, basis: 'catalog', vendor });
  });

  it('only matches path-scoped hosts on their telemetry path', () => {
    expect(classify('storybook.js.org', '/event-log').basis).toBe('catalog');
    expect(classify('storybook.js.org', '/docs/get-started').basis).toBe('none');
    expect(classify('huggingface.co', '/api/models/x').category).toBe('other');
  });

  it('recognises self-hosted collectors by path', () => {
    expect(classify('sp.example.com', '/com.snowplowanalytics.snowplow/tp2')).toMatchObject({ category: 'analytics', basis: 'heuristic' });
    expect(classify('otel.internal', '/v1/traces').category).toBe('analytics');
  });
});

describe('opt-out catalog', async () => {
  const { OPT_OUTS, optOutEnv } = await import('../src/catalog/optouts.js');
  it('has unique, valid names, values and https sources', () => {
    const names = new Set<string>();
    for (const o of OPT_OUTS) {
      expect(o.name).toMatch(/^[A-Z][A-Z0-9_]*$/);
      expect(o.value).not.toBe('');
      expect(o.source).toMatch(/^https:\/\//);
      expect(o.tools.length).toBeGreaterThan(0);
      expect(names.has(o.name), o.name).toBe(false);
      names.add(o.name);
    }
    expect(optOutEnv()).toMatchObject({ DO_NOT_TRACK: '1', NEXT_TELEMETRY_DISABLED: '1' });
  });
});
