// Make a real capture safe to commit as a test fixture: every id-shaped value in request
// bodies is replaced, consistently across all input files, with a fake of the same shape,
// and response bodies are dropped.
// Usage: node scripts/scrub-har.mjs <in.har> <out.har> [<in2.har> <out2.har> ...]
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';
import console from 'node:console';

const pairs = process.argv.slice(2);
if (pairs.length === 0 || pairs.length % 2) throw new Error('usage: scrub-har.mjs <in> <out> [...]');
const ID = /^(?:[0-9a-f]{16,128}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
const fakes = new Map();
const fake = (v) => {
  if (!fakes.has(v)) {
    const h = createHash('sha256').update(`whatleaks-fixture:${v}`).digest('hex');
    fakes.set(v, v.replace(/[0-9a-f]/gi, (_, i) => h[i % 64]));
  }
  return fakes.get(v);
};
const walk = (x) => {
  if (typeof x === 'string') return ID.test(x) ? fake(x) : x;
  if (Array.isArray(x)) return x.map(walk);
  if (x && typeof x === 'object') return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, walk(v)]));
  return x;
};
for (let i = 0; i < pairs.length; i += 2) {
  const har = JSON.parse(readFileSync(pairs[i], 'utf8'));
  for (const e of har.log.entries) {
    const pd = e.request.postData;
    if (pd?.text && !pd._encoding) {
      try {
        pd.text = JSON.stringify(walk(JSON.parse(pd.text)));
      } catch {
        // not JSON; leave it
      }
    }
    delete e.response.content.text;
    e.request.headers = e.request.headers.filter((h) => !/^(cookie|authorization)$/i.test(h.name));
  }
  writeFileSync(pairs[i + 1], `${JSON.stringify(har, null, 2)}\n`);
}
console.log(`scrubbed ${fakes.size} id values`);
