import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { FAKE_IDS, chattyHar } from './helpers/fixtures.js';
import { harText } from './helpers/har.js';

const exec = promisify(execFile);
const root = new URL('..', import.meta.url);
const env = { ...process.env, WHATLEAKS_IDENTITIES_JSON: JSON.stringify(FAKE_IDS), NO_COLOR: '1' };

async function cli(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await exec(process.execPath, ['dist/cli.js', ...args], { cwd: root, env });
    return { code: 0, stdout, stderr };
  } catch (err) {
    const e = err as { code: number; stdout: string; stderr: string };
    return { code: e.code, stdout: e.stdout, stderr: e.stderr };
  }
}

describe('whatleaks report', () => {
  it('prints a report and writes Markdown and JSON', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'wl-cli-'));
    const har = join(dir, 'chatty.har');
    await writeFile(har, harText(chattyHar()));
    const r = await cli(['report', har, '--md', join(dir, 'r.md'), '--json', join(dir, 'r.json'), '--samples', '1']);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('9 requests to 6 destinations');
    expect(r.stdout).toContain('A MAC address of this machine as sha256');
    expect(r.stderr).toContain('Markdown report written to');
    const json = JSON.parse(await readFile(join(dir, 'r.json'), 'utf8')) as { schema: string; endpoints: Array<{ samples: unknown[] }> };
    expect(json.schema).toBe('whatleaks/report@1');
    expect(json.endpoints[0]?.samples).toHaveLength(1);
    expect(await readFile(join(dir, 'r.md'), 'utf8')).toContain('## What it sent about you');
  });

  it('labels imported HAR by file name', async () => {
    const r = await cli(['report', 'test/fixtures/mitmproxy-form.har']);
    expect(r.stdout).toMatch(/^whatleaks · mitmproxy-form\.har/);
    expect(r.stdout).toContain('www.google-analytics.com');
    expect(r.stdout).not.toContain('s3cr3t');
  });

  it('exits 2 with a clear message for missing or invalid files', async () => {
    const missing = await cli(['report', 'nope.har']);
    expect(missing.code).toBe(2);
    expect(missing.stderr).toBe('whatleaks: cannot read nope.har: ENOENT\n');
    const bad = await cli(['report', 'package.json']);
    expect(bad.code).toBe(2);
    expect(bad.stderr).toContain('is not a usable HAR file: missing "log" object');
  });
});
