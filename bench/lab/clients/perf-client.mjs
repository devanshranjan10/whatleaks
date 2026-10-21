// Performance client: times requests to the lab and writes the numbers to PERF_OUT.
//
//   node perf-client.mjs latency <n> <keepalive|fresh>
//   node perf-client.mjs upload <n> <MiB>
import { writeFileSync } from 'node:fs';
import https from 'node:https';

const E = process.env;
const [mode, nArg = '200', opt = 'keepalive'] = process.argv.slice(2);
const n = Number(nArg);
const url = (i) => `https://${E.LAB_HOST}:${E.LAB_PORT}/perf/${mode}/${i}`;

function post(agent, i, body) {
  return new Promise((resolve, reject) => {
    const t0 = process.hrtime.bigint();
    const req = https.request(url(i), { method: 'POST', agent, headers: { 'content-type': 'application/octet-stream', 'content-length': body.length } }, (res) => {
      res.resume();
      res.on('end', () => resolve(Number(process.hrtime.bigint() - t0) / 1e6));
    });
    req.on('error', reject);
    req.end(body);
  });
}

const out = { mode, n, opt, ms: [], wallMs: 0 };
const t0 = Date.now();
if (mode === 'latency') {
  const agent = opt === 'keepalive' ? new https.Agent({ keepAlive: true, maxSockets: 1 }) : new https.Agent({ keepAlive: false });
  const body = Buffer.alloc(1024, 97);
  for (let i = 0; i < n; i++) out.ms.push(await post(agent, i, body));
  agent.destroy();
} else if (mode === 'upload') {
  const agent = new https.Agent({ keepAlive: true, maxSockets: 1 });
  const body = Buffer.alloc(Number(opt) * 1024 * 1024, 98);
  for (let i = 0; i < n; i++) out.ms.push(await post(agent, i, body));
  out.bytes = body.length * n;
  agent.destroy();
}
out.wallMs = Date.now() - t0;
writeFileSync(E.PERF_OUT, JSON.stringify(out));
