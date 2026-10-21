import { spawn } from 'node:child_process';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const cli = new URL('../../dist/cli.js', import.meta.url).pathname;

describe('Ctrl-C while waiting for leftover processes', () => {
  it('stops waiting, stops the leftovers, still writes the HAR and cleans up', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'wl-sig-'));
    const pidFile = join(dir, 'helper.pid');
    const app = `const c = require('node:child_process').spawn('sleep', ['30'], { detached: true, stdio: 'ignore' }); c.unref(); require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(c.pid)); setTimeout(() => process.exit(0), 700);`;
    // A private temp dir, so other tests running in parallel cannot affect the cleanup check.
    const privateTmp = await mkdtemp(join(tmpdir(), 'wl-sig-tmp-'));
    const proc = spawn(process.execPath, [cli, 'run', '--no-color', '--linger', '20', '--out', join(dir, 'c.har'), '--', process.execPath, '-e', app], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, WHATLEAKS_IDENTITIES_JSON: '[]', TMPDIR: privateTmp },
    });
    let stderr = '';
    proc.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    // Wait until whatleaks says it is waiting for leftovers, then interrupt it.
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`never started waiting: ${stderr}`)), 15_000);
      proc.stderr.on('data', () => {
        if (stderr.includes('waiting up to')) {
          clearTimeout(t);
          resolve();
        }
      });
    });
    const t0 = Date.now();
    proc.kill('SIGINT');
    const code = await new Promise<number | null>((r) => proc.on('exit', (c) => r(c)));
    expect(Date.now() - t0).toBeLessThan(8000);
    expect(code).toBe(0);
    const har = JSON.parse(await readFile(join(dir, 'c.har'), 'utf8')) as { log: { _whatleaks: { notes: string[] } } };
    expect(har.log._whatleaks.notes.join(' ')).toContain('Interrupted while waiting');
    const helper = Number(await readFile(pidFile, 'utf8'));
    await new Promise((r) => setTimeout(r, 300));
    expect(() => process.kill(helper, 0)).toThrow();
    expect((await readdir(privateTmp)).filter((f) => f.startsWith('whatleaks-'))).toEqual([]);
  });
});
