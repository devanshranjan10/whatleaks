import { mkdtemp, readdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createObserver } from '../../src/capture/observer.js';
import { compareCommand } from '../../src/commands/compare.js';
import type { Diff } from '../../src/diff/diff.js';
import type { Har } from '../../src/har/types.js';
import { type Upstream, startUpstream } from '../helpers/upstream.js';

const FAKE_TOOL = `
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const idFile = path.join(process.env.FAKE_STATE_DIR, 'install-id');
let id;
try { id = fs.readFileSync(idFile, 'utf8'); } catch { id = crypto.randomUUID(); fs.writeFileSync(idFile, id); }
const post = (p, body) => fetch('https://upstream.test' + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
(async () => {
  if (process.env.DO_NOT_TRACK !== '1') await post('/v1/telemetry', { installId: id, event: 'build', cwd: process.cwd() });
  await post('/v1/ping', { installId: id });
})();
`;

let upstream: Upstream;
const savedIds = process.env.WHATLEAKS_IDENTITIES_JSON;
beforeAll(async () => {
  upstream = await startUpstream();
  process.env.WHATLEAKS_IDENTITIES_JSON = '[]';
});
afterAll(async () => {
  await upstream.close();
  if (savedIds === undefined) delete process.env.WHATLEAKS_IDENTITIES_JSON;
  else process.env.WHATLEAKS_IDENTITIES_JSON = savedIds;
});

describe('compare', () => {
  it('runs defaults then opted out, and shows what is still sent', async () => {
    const dir = await realpath(await mkdtemp(join(tmpdir(), 'wl-compare-')));
    const tool = join(dir, 'fake-tool.js');
    await writeFile(tool, FAKE_TOOL);
    const out: string[] = [];
    const err: string[] = [];
    const code = await compareCommand(
      [process.execPath, tool],
      { lingerSec: 2, env: [`FAKE_STATE_DIR=${dir}`], noDecrypt: [], watch: true, samples: 1, raw: false, color: false, offEnv: [], knownOptOuts: true, outDir: 'caps', strict: true, json: join(dir, 'diff.json') },
      { stdout: (s) => out.push(s), stderr: (s) => err.push(s) },
      // The parent environment already opts out; run 1 must remove it to get real defaults.
      { testRoutes: { 'upstream.test': upstream.url }, stdio: 'ignore', cwd: dir, env: { ...process.env, DO_NOT_TRACK: '1' }, observers: createObserver({ reverse: () => Promise.resolve([]) }) },
    );
    expect(code).toBe(1); // --strict: the ping is still sent
    const stdout = out.join('');
    expect(stdout).toContain('STILL SENDING AFTER OPT-OUT');
    expect(stdout).toContain('POST upstream.test/v1/ping');
    expect(err.join('')).toContain('run 2 of 2');

    const diff = JSON.parse(await readFile(join(dir, 'diff.json'), 'utf8')) as Diff;
    expect(diff.endpoints.map((e) => [e.key, e.status])).toEqual([
      ['POST upstream.test/v1/ping', 'still'],
      ['POST upstream.test/v1/telemetry', 'stopped'],
    ]);
    expect(diff.persistentIds).toHaveLength(1);
    expect(diff.persistentIds[0]?.locations).toEqual(['installId']);
    expect(diff.findingsStopped).toContain('project-path');
    expect(diff.after.optOutEnv).toContain('DO_NOT_TRACK');

    const hars = (await readdir(join(dir, 'caps'))).sort();
    expect(hars).toHaveLength(2);
    const first = JSON.parse(await readFile(join(dir, 'caps', hars[0]!), 'utf8')) as Har;
    expect(first.log._whatleaks?.label).toBe('default');
    expect(first.log._whatleaks?.notes.join(' ')).toContain('Removed opt-out variables from this run');
  });

  it('refuses to compare with nothing to opt out of', async () => {
    const err: string[] = [];
    const code = await compareCommand(['true'], { lingerSec: 1, env: [], noDecrypt: [], watch: false, samples: 0, raw: false, color: false, offEnv: [], knownOptOuts: false, outDir: '.', strict: false }, { stdout: () => {}, stderr: (s) => err.push(s) });
    expect(code).toBe(2);
    expect(err.join('')).toContain('nothing to opt out of');
  });
});
