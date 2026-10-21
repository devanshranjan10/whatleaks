import { execFile } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const run = promisify(execFile);
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };

describe('cli', () => {
  it('prints the package version', async () => {
    const { stdout } = await run(process.execPath, ['dist/cli.js', '--version'], { cwd: new URL('..', import.meta.url) });
    expect(stdout.trim()).toBe(pkg.version);
  });

  it.skipIf(process.getuid?.() === 0)('reports an operating-system error in one line, without a stack trace', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wl-ro-'));
    chmodSync(dir, 0o500);
    const har = new URL('fixtures/chrome-devtools.har', import.meta.url).pathname;
    const err = await run(process.execPath, ['dist/cli.js', 'report', har, '--md', join(dir, 'r.md')], { cwd: new URL('..', import.meta.url) }).catch((e: { code: number; stderr: string }) => e);
    chmodSync(dir, 0o700);
    expect(err).toMatchObject({ code: 1 });
    expect((err as { stderr: string }).stderr.trim()).toMatch(/^whatleaks: open failed for .*r\.md.*: permission denied \(EACCES\)$/);
  });
});
