import { describe, expect, it } from 'vitest';
import { buildMatchers } from '../src/analyze/identity.js';
import { REDACTED, makeRedactor, sanitize, sanitizeDeep } from '../src/analyze/redact.js';
import { FAKE_IDS, sha256 } from './helpers/fixtures.js';

const UUID = '0f8fad5b-d9cb-469f-a165-70867728950e';
const mk = () => makeRedactor(buildMatchers(FAKE_IDS));

describe('text', () => {
  it('replaces identifiers with labels, longest first, on word boundaries', () => {
    const r = mk();
    expect(r.text('cwd /Users/janedoe/x by janedoe')).toBe('cwd ‹home›/x by ‹username›');
    expect(r.text(`id ${sha256('a4:83:e7:12:34:56')}`)).toBe('id ‹sha256(mac)›');
    expect(r.text('ping bob@x.io')).toBe('ping ‹email›');
    // A longer word that contains the username is not touched.
    expect(r.text('janedoes-files')).toBe('janedoes-files');
  });
});

describe('leaf', () => {
  it('redacts secret headers and fields, aliases ids, keeps the rest', () => {
    const r = mk();
    expect(r.leaf('header:authorization', 'Bearer abc')).toBe(REDACTED);
    expect(r.leaf('header:cookie', 'a=b')).toBe(REDACTED);
    expect(r.leaf('header:x-request-token', 'abcdef')).toBe(REDACTED);
    expect(r.leaf('a.b[].api_key', 'zzzzzz')).toBe(REDACTED);
    expect(r.leaf('o["access-token"]', 'zzzzzz')).toBe(REDACTED);
    // Nested under a secret-named parent.
    expect(r.leaf('auth.value', 'hunter22')).toBe(REDACTED);
    expect(r.leaf('ctx.anonymousId', UUID)).toBe('‹id-1›');
    expect(r.leaf('other', UUID)).toBe('‹id-1›'); // same value, same alias
    expect(r.leaf('event', 'Build Completed')).toBe('Build Completed');
    expect(r.leaf('author', 'Some Body')).toBe('Some Body');
    expect(r.leaf('header::authority', 'api.example.com')).toBe('api.example.com');
  });
});

describe('value', () => {
  it('redacts secret subtrees (strings and numbers), aliases id keys, keeps ordinary numbers', () => {
    const r = mk();
    expect(
      r.value({
        apiKey: 'abcd1234',
        input_tokens: 512,
        author: 'x',
        nested: [{ password: 'hunter22' }],
        auth: { value: 'hunter2', pin: 123456 },
        credentials: { key: 'AKIAEXAMPLE' },
        devices: { [UUID]: { seen: true } },
      }),
    ).toEqual({
      apiKey: REDACTED,
      input_tokens: 512,
      author: 'x',
      nested: [{ password: REDACTED }],
      auth: { value: REDACTED, pin: REDACTED },
      credentials: { key: REDACTED },
      devices: { '‹id-1›': { seen: true } },
    });
  });
});

describe('freeText', () => {
  it('redacts secrets in JSON-ish, form, multipart and header-line text, and aliases ids', () => {
    const r = mk();
    expect(r.freeText('{"token":"ghp_abcdefghijklmnop","sessionId":"' + UUID + '","n":1}')).toBe(
      `{"token":"${REDACTED}","sessionId":"‹id-1›","n":1}`,
    );
    // A body cut at the size cap can end inside the secret.
    expect(r.freeText('{"a":1,"token":"plainsecretvalue')).toBe(`{"a":1,"token":"${REDACTED}"`);
    expect(r.freeText('a=1&api_key=sk_live_1234&b=2')).toBe(`a=1&api_key=${REDACTED}&b=2`);
    expect(r.freeText('--x\r\nContent-Disposition: form-data; name="password"\r\n\r\nhunter22\r\n--x')).toBe(
      `--x\r\nContent-Disposition: form-data; name="password"\r\n\r\n${REDACTED}\r\n--x`,
    );
    expect(r.freeText('GET / HTTP/1.1\nAuthorization: Bearer abc.def\nHost: x')).toBe(`GET / HTTP/1.1\nAuthorization: ${REDACTED}\nHost: x`);
    expect(r.freeText(`device ${UUID} from janes-mbp`)).toBe('device ‹id-1› from ‹hostname›');
  });
});

describe('url', () => {
  it('labels identifiers and aliases ids in host, path and query', () => {
    const r = mk();
    expect(r.url(`https://janes-mbp.local:3000/users/janedoe/devices/${UUID}/ping?api_secret=s3cr3tvalue&v=1&cid=${UUID}`)).toBe(
      `https://‹hostname›.local:3000/users/‹username›/devices/‹id-1›/ping?api_secret=${REDACTED}&v=1&cid=‹id-1›`,
    );
    expect(r.url('https://x.example/users/someone%40example.org/x')).toBe('https://x.example/users/‹email›/x');
  });
});

describe('argv', () => {
  it('redacts secret flags and identifiers in a command line', () => {
    const r = mk();
    expect(r.argv(['/Users/janedoe/bin/tool', '--api-key=sk_live_x1', '--token', 'abc123', 'dev@else.org', 'build'])).toEqual([
      '‹home›/bin/tool',
      `--api-key=${REDACTED}`,
      '--token',
      REDACTED,
      '‹email›',
      'build',
    ]);
  });
});

describe('disabled', () => {
  it('is a no-op with --raw', () => {
    const raw = makeRedactor(buildMatchers(FAKE_IDS), false);
    expect(raw.text('janedoe')).toBe('janedoe');
    expect(raw.leaf('header:authorization', 'x')).toBe('x');
    expect(raw.argv(['--token', 'abc'])).toEqual(['--token', 'abc']);
    expect(raw.url(`https://x.example/${UUID}`)).toBe(`https://x.example/${UUID}`);
  });
});

describe('sanitize', () => {
  it('neutralises terminal escapes but keeps newlines, tabs and CR', () => {
    expect(sanitize('a\u001b[2Kb\u001b]52;c;Zm9v\u0007c\n\t\r')).toBe('a\\x1b[2Kb\\x1b]52;c;Zm9v\\x07c\n\t\r');
    expect(sanitizeDeep({ ['k\u001b']: ['v\u009b'] })).toEqual({ 'k\\x1b': ['v\\x9b'] });
  });
});
