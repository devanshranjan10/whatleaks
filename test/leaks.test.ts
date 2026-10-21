import { describe, expect, it } from 'vitest';
import { buildMatchers } from '../src/analyze/identity.js';
import { buildReport } from '../src/analyze/report.js';
import { buildDiff } from '../src/diff/diff.js';
import { parseHar } from '../src/har/read.js';
import { renderDiffMarkdown, renderDiffTerminal } from '../src/render/diff.js';
import { renderJson } from '../src/render/json.js';
import { renderMarkdown } from '../src/render/markdown.js';
import { renderTerminal } from '../src/render/terminal.js';
import { FAKE_IDS } from './helpers/fixtures.js';
import { harText, makeHar } from './helpers/har.js';

// Every value here was printed in full by an earlier build (independent review, 2026-10-21).
const UUID = '9b2e6c1a-4f3d-4c5e-8a7b-1d2e3f4a5b6c';
const SECRETS = ['ghp_wsTokenValue123', 'hunter22multipart', 'plainsecretvalue', 'sk_live_cmdline1', 'janedoe', 'janes-mbp', 'jane@doe.dev', UUID, 'AKIAEXAMPLEKEY', 'nestedpw77', '8f3a2b1c9d8e7f6a5b4c3d2e1f0a9b8c'];

function leakyHar() {
  return makeHar(
    [
      // WebSocket messages are free text.
      { at: 0, method: 'GET', url: 'wss://ws.example/socket', meta: { websocket: { sent: 1, samples: [`{"token":"ghp_wsTokenValue123","sessionId":"${UUID}"}`] } } },
      // Multipart text body.
      {
        at: 100,
        url: 'https://upload.example/form',
        contentType: 'multipart/form-data; boundary=x',
        body: '--x\r\nContent-Disposition: form-data; name="password"\r\n\r\nhunter22multipart\r\n--x--\r\n',
      },
      // JSON cut at the size cap, so it parses only as text.
      { at: 200, url: 'https://t.example/batch', contentType: 'application/json', body: '{"events":[1,2],"token":"plainsecretvalue', meta: { truncated: true } },
      // Identifiers in the host and the path; an encoded email; an id in the path.
      { at: 300, url: `https://janes-mbp.local:3000/api/users/janedoe/devices/${UUID}/u/jane%40doe.dev/ping` },
      // Nested secrets, numeric secret, id-like key.
      { at: 400, url: 'https://t.example/cfg', body: { auth: { value: 'nestedpw77' }, credentials: { key: 'AKIAEXAMPLEKEY' }, pin: { secret: 12345678 }, devices: { '8f3a2b1c9d8e7f6a5b4c3d2e1f0a9b8c': { seen: true } } } },
      // Terminal escape sequences in a text body.
      { at: 500, url: 'https://t.example/log', contentType: 'text/plain', body: 'line\u001b[2Kcleared, then more ordinary text' },
    ],
    { command: ['/Users/janedoe/bin/tool', '--api-key=sk_live_cmdline1', 'jane@doe.dev'], refused: [{ host: 'janes-mbp.local', count: 1, cause: 'cert-rejected', firstAt: '', lastAt: '' }] },
  );
}

describe('redacted output never contains the planted values', () => {
  const matchers = buildMatchers(FAKE_IDS);
  const report = buildReport(parseHar(harText(leakyHar())), { matchers, samples: 3 });
  const outputs = {
    terminal: renderTerminal(report),
    markdown: renderMarkdown(report),
    json: renderJson(report),
    diffTerminal: renderDiffTerminal(buildDiff(report, report)),
    diffMarkdown: renderDiffMarkdown(buildDiff(report, report)),
  };

  for (const [name, text] of Object.entries(outputs)) {
    it(`${name}`, () => {
      for (const s of SECRETS) expect(text, `${name} leaks ${s}`).not.toContain(s);
      expect(text).not.toContain('\u001b');
      expect(text).not.toContain('\u0007');
    });
  }

  it('still shows the shape of what was sent', () => {
    expect(outputs.markdown).toContain('‹redacted›');
    expect(outputs.terminal).toContain('GET ‹hostname›.local:3000/api/users/‹username›/devices/:id/u/:id/ping');
    expect(outputs.terminal).toContain('‹home›/bin/tool --api-key=‹redacted› ‹git-email›');
    expect(outputs.markdown).toContain('line\\x1b[2Kcleared');
  });

  it('shows everything with --raw (except control characters)', () => {
    const raw = renderMarkdown(buildReport(parseHar(harText(leakyHar())), { matchers, samples: 3, raw: true }));
    expect(raw).toContain('hunter22multipart');
    expect(raw).toContain(UUID);
    expect(raw).not.toContain('\u001b');
  });
});

describe('identity detection beyond the leaf limits', () => {
  it('finds a home path deeper than 8 levels, past 500 leaves, and in a JSON key', () => {
    let deep: unknown = '/Users/janedoe/secret-project';
    for (let i = 0; i < 10; i++) deep = { d: deep };
    const many = Object.fromEntries(Array.from({ length: 600 }, (_, i) => [`k${i}`, i === 550 ? '/Users/janedoe/x' : 'v']));
    const keyed = { '/Users/janedoe/proj': { size: 1 } };
    for (const body of [deep, many, keyed]) {
      const r = buildReport(parseHar(harText(makeHar([{ at: 0, url: 'https://t.example/e', body: body as object }]))), { matchers: buildMatchers(FAKE_IDS) });
      expect(r.findings.map((f) => f.kind)).toContain('home');
    }
  });
});
