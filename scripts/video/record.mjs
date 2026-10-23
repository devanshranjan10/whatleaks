// Runs a command with colour forced and records every output chunk with its time, for replaying in the demo video.
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const [out, ...cmd] = process.argv.slice(2);
const t0 = performance.now();
const chunks = [];
const p = spawn(cmd[0], cmd.slice(1), { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, FORCE_COLOR: '1' } });
for (const [name, s] of [['out', p.stdout], ['err', p.stderr]]) {
  s.on('data', (d) => {
    chunks.push({ t: Math.round(performance.now() - t0), s: name, d: d.toString('utf8') });
    (name === 'out' ? process.stdout : process.stderr).write(d);
  });
}
p.on('close', (code, sig) => {
  writeFileSync(out, JSON.stringify({ cmd, code, sig, ms: Math.round(performance.now() - t0), chunks }, null, 1));
  process.exitCode = code ?? 1;
});
