// Linux check, run inside a minimal container (node:22-slim has no ps, lsof, netstat,
// curl or python). Each scenario runs the real CLI and reads its HAR. Targets are real
// hosts (example.com), so this needs network. Usage, from the repo root:
//
//   docker run --rm -v "$PWD":/w:ro -w /tmp node:22-slim node /w/bench/linux/check.mjs
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CLI = process.env.WL_CLI ?? '/w/dist/cli.js';
const work = mkdtempSync(join(tmpdir(), 'wl-linux-'));
const results = [];

function capture(id, script, extra = []) {
  const file = join(work, `${id}.js`);
  writeFileSync(file, script);
  const har = join(work, `${id}.har`);
  const r = spawnSync(process.execPath, [CLI, 'run', '--no-color', '-o', har, ...extra, '--', process.execPath, file], { cwd: work, encoding: 'utf8', timeout: 120_000 });
  const h = JSON.parse(readFileSync(har, 'utf8'));
  return { har: h, meta: h.log._whatleaks, out: r.stdout + r.stderr };
}

function check(id, title, ok, detail) {
  results.push({ id, title, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${title}  ${detail}`);
}

{
  const c = capture('fetch', "fetch('https://example.com/wl-linux-fetch', { method: 'POST', body: 'linux=1' }).then((r) => r.text()).then(() => process.exit(0), () => process.exit(3));");
  const e = c.har.log.entries.find((x) => x.request.url.includes('wl-linux-fetch'));
  check('fetch', 'Node fetch captured with body', e?.request.postData?.text === 'linux=1', `entries=${c.har.log.entries.length} watcher=${c.meta.watcher}`);
}
{
  const c = capture(
    'http2',
    "const c = require('node:http2').connect('https://example.com'); const r = c.request({ ':path': '/wl-linux-h2' }); r.resume(); r.on('end', () => setTimeout(() => { c.close(); process.exit(0); }, 600)); c.on('error', () => process.exit(4));",
  );
  const d = c.meta.direct.filter((x) => x.port === 443);
  check('http2-direct', 'node:http2 (ignores the proxy) named as a direct connection, held 600 ms', d.length > 0, JSON.stringify(d.map((x) => `${x.remote}:${x.port} ${x.process} ×${x.connections ?? 1}`)));
}
{
  // Repeated: a 10 ms socket is caught only if a /proc poll lands inside its lifetime.
  const N = Number(process.env.TCP_RUNS ?? 20);
  let hit = 0;
  for (let i = 0; i < N; i++) {
    const c = capture(`tcp10-${i}`, "const s = require('node:net').connect(80, 'example.com', () => { s.write('GET / HTTP/1.0\\r\\n\\r\\n'); setTimeout(() => { s.destroy(); process.exit(0); }, 10); }); s.on('error', () => process.exit(5));");
    if (c.meta.direct.some((x) => x.port === 80)) hit++;
  }
  check('tcp-10ms', `raw TCP held 10 ms named (Linux: a closed socket has no owner, so only live ones count), ${N} runs`, hit / N >= 0.9, `${hit}/${N}`);
}
{
  const helper = "setTimeout(() => fetch('https://example.com/wl-linux-late', { method: 'POST', body: 'late' }).finally(() => process.exit(0)), 2000)";
  const t0 = Date.now();
  const c = capture('helper', `require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(helper)}], { detached: true, stdio: 'ignore' }).unref(); process.exit(0);`);
  const secs = (Date.now() - t0) / 1000;
  const e = c.har.log.entries.find((x) => x.request.url.includes('wl-linux-late'));
  check('helper-2s', 'detached helper sending 2 s after its parent exited', e?.request.postData?.text === 'late', `entries=${c.har.log.entries.length}`);
  // PID 1 here (this script) never reaps orphans, so the finished helper stays a zombie.
  // whatleaks must not wait --linger (10 s) for it.
  check('zombie', 'a finished helper left as a zombie is not waited for', secs < 8, `run took ${secs.toFixed(1)} s`);
}
{
  const c = capture('meta', 'process.exit(0)');
  check('no-tools', 'process tree and watcher work without ps/lsof/netstat', c.meta.watcher === 'on' && !c.meta.notes.some((n) => /Could not/.test(n)), `watcher=${c.meta.watcher} notes=${JSON.stringify(c.meta.notes)}`);
}

const failed = results.filter((r) => !r.ok).length;
console.log(JSON.stringify({ node: process.version, platform: process.platform, arch: process.arch, results }, null, 2));
process.exit(failed ? 1 : 0);
