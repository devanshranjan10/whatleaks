import { execFile } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { buildDiff, stillSendsTelemetry } from '../src/diff/diff.js';
import { buildMatchers } from '../src/analyze/identity.js';
import { buildReport } from '../src/analyze/report.js';
import { parseHar } from '../src/har/read.js';
import type { Har } from '../src/har/types.js';
import { renderDiffMarkdown, renderDiffTerminal } from '../src/render/diff.js';
import { ANON_ID, FAKE_IDS, TEST_RULES, chattyHar } from './helpers/fixtures.js';
import { harText, makeHar } from './helpers/har.js';

const matchers = buildMatchers(FAKE_IDS);
const rep = (har: Har) => buildReport(parseHar(harText(har)), { matchers, rules: TEST_RULES });

/** Second run: Segment still sends (fewer fields), Sentry and the tool's events stop, a new ping appears. */
function afterHar(): Har {
  return makeHar(
    [
      { at: 1_000, url: 'https://api.segment.io/v1/batch', body: { batch: [{ type: 'track', event: 'Build Completed', anonymousId: ANON_ID }] } },
      { at: 9_000, url: 'https://api.segment.io/v1/batch', body: { batch: [{ type: 'track', event: 'Build Completed', anonymousId: ANON_ID, optedOut: true }] } },
      { at: 3_000, url: 'https://registry.npmjs.org/left-pad' },
      { at: 4_000, url: 'https://flags.example.com/sdk/evalx/abc', body: { user: { key: 'anon' } } },
      { at: 5_000, url: 'https://telemetry.example-tool.dev/v2/ping', body: { host: 'janes-mbp' } },
    ],
    { label: 'opted-out', optOutEnv: ['DO_NOT_TRACK', 'NEXT_TELEMETRY_DISABLED'], command: ['fake-tool', 'build'] },
    undefined,
    50_000,
  );
}

const diff = buildDiff(rep(chattyHar()), rep(afterHar()));

describe('buildDiff', () => {
  it('classifies endpoints as still, new or stopped', () => {
    expect(diff.endpoints.map((e) => [e.status, e.key, `${e.before?.count ?? 0}→${e.after?.count ?? 0}`])).toEqual([
      ['still', 'POST api.segment.io/v1/batch', '3→2'],
      ['still', 'POST flags.example.com/sdk/evalx/abc', '1→1'],
      ['still', 'GET registry.npmjs.org/left-pad', '2→1'],
      ['new', 'POST telemetry.example-tool.dev/v2/ping', '0→1'],
      ['stopped', 'POST collector.example.net/v1/traces', '1→0'],
      ['stopped', 'POST telemetry.example-tool.dev/v1/events', '1→0'],
      ['stopped', 'POST o123.ingest.sentry.io/api/:id/envelope/', '1→0'],
    ]);
  });

  it('computes the headline over telemetry endpoints only', () => {
    expect(diff.headline).toEqual({
      telemetryEndpointsBefore: 5,
      telemetryEndpointsStill: 2,
      telemetryEndpointsNew: 1,
      telemetryRequestsBefore: 7,
      telemetryRequestsAfter: 4,
    });
    expect(stillSendsTelemetry(diff)).toBe(true);
  });

  it('diffs fields per endpoint', () => {
    const seg = diff.endpoints[0]!;
    expect(seg.fieldsStill).toEqual(['batch[].anonymousId', 'batch[].event', 'batch[].type']);
    expect(seg.fieldsDropped).toContain('batch[].properties.cwd');
    expect(seg.fieldsDropped).toContain('header:authorization');
    expect(seg.fieldsAdded).toEqual(['batch[].optedOut']);
  });

  it('finds identifiers that persist across runs and findings that remain', () => {
    expect(diff.persistentIds).toEqual([
      { fingerprint: expect.stringMatching(/^[0-9a-f]{12}$/) as string, display: '0f8f…950e', locations: ['batch[].anonymousId'], endpoints: ['POST api.segment.io/v1/batch'] },
    ]);
    expect(diff.findingsStill.map((f) => f.kind)).toEqual(['hostname', 'stable-id']);
    expect(diff.findingsStopped).toEqual(expect.arrayContaining(['mac', 'home', 'username', 'git-email']));
  });

  it('adds caveats for stops and very different run lengths', () => {
    expect(diff.caveats.some((c) => c.startsWith('"Stopped" means not seen'))).toBe(true);
    const short = makeHar([{ at: 0, url: 'https://api.segment.io/v1/batch', body: { a: 1 } }], {}, undefined, 5_000);
    const d2 = buildDiff(rep(chattyHar()), rep(short));
    expect(d2.caveats.some((c) => c.includes('not like for like'))).toBe(true);
  });

  it('reports a clean opt-out', () => {
    const clean = buildDiff(rep(chattyHar()), rep(makeHar([{ at: 0, url: 'https://registry.npmjs.org/left-pad' }])));
    expect(stillSendsTelemetry(clean)).toBe(false);
    expect(renderDiffTerminal(clean)).toContain('All 5 telemetry endpoints stopped after opting out.');
    expect(renderDiffTerminal(clean)).toContain("nothing identifying in the second run's visible traffic");
  });
});

describe('diff rendering', () => {
  it('renders terminal and markdown', async () => {
    await expect(renderDiffTerminal(diff)).toMatchFileSnapshot('golden/diff.txt');
    await expect(renderDiffMarkdown(diff)).toMatchFileSnapshot('golden/diff.md');
  });
});

describe('whatleaks diff (CLI)', () => {
  const exec = promisify(execFile);
  const run = async (args: string[]) => {
    try {
      const r = await exec(process.execPath, ['dist/cli.js', ...args], {
        cwd: new URL('..', import.meta.url),
        env: { ...process.env, WHATLEAKS_IDENTITIES_JSON: JSON.stringify(FAKE_IDS), NO_COLOR: '1' },
      });
      return { code: 0, ...r };
    } catch (err) {
      return err as { code: number; stdout: string; stderr: string };
    }
  };

  it('exits 1 under --strict when telemetry is still sent, 0 otherwise', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'wl-diff-'));
    await writeFile(join(dir, 'on.har'), harText(chattyHar()));
    await writeFile(join(dir, 'off.har'), harText(afterHar()));
    await writeFile(join(dir, 'clean.har'), harText(makeHar([{ at: 0, url: 'https://registry.npmjs.org/x' }])));
    const strict = await run(['diff', join(dir, 'on.har'), join(dir, 'off.har'), '--strict']);
    expect(strict.code).toBe(1);
    expect(strict.stdout).toContain('STILL SENDING AFTER OPT-OUT');
    expect(strict.stderr).toContain('--strict');
    const lax = await run(['diff', join(dir, 'on.har'), join(dir, 'off.har')]);
    expect(lax.code).toBe(0);
    const clean = await run(['diff', join(dir, 'on.har'), join(dir, 'clean.har'), '--strict']);
    expect(clean.code).toBe(0);
  });
});
