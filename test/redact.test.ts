import { describe, expect, it } from 'vitest';
import { buildMatchers } from '../src/analyze/identity.js';
import { REDACTED, makeRedactor } from '../src/analyze/redact.js';
import { FAKE_IDS, sha256 } from './helpers/fixtures.js';

const r = makeRedactor(buildMatchers(FAKE_IDS));

describe('redactor', () => {
  it('replaces identifiers with labels, longest first', () => {
    expect(r.text('cwd /Users/janedoe/x by janedoe')).toBe('cwd ‹home›/x by ‹username›');
    expect(r.text(`id ${sha256('a4:83:e7:12:34:56')}`)).toBe('id ‹sha256(mac)›');
    expect(r.text('ping bob@x.io')).toBe('ping ‹email›');
  });

  it('redacts secret headers but keeps ordinary ones', () => {
    expect(r.header('Authorization', 'Bearer abc')).toBe(REDACTED);
    expect(r.header('x-request-token', 'abcdef')).toBe(REDACTED);
    expect(r.header(':authority', 'api.example.com')).toBe('api.example.com');
    expect(r.header('user-agent', 'tool janes-mbp')).toBe('tool ‹hostname›');
  });

  it('redacts secret-named string values in JSON but keeps numbers', () => {
    expect(r.value({ apiKey: 'abcd1234', input_tokens: 512, author: 'x', nested: [{ password: 'hunter22' }] })).toEqual({
      apiKey: REDACTED,
      input_tokens: 512,
      author: 'x',
      nested: [{ password: REDACTED }],
    });
  });

  it('redacts secret query params and identifiers in URLs', () => {
    expect(r.url('https://x.example/p/janedoe?api_secret=s3cr3tvalue&v=1')).toBe(
      `https://x.example/p/‹username›?api_secret=${encodeURIComponent(REDACTED)}&v=1`.replace(encodeURIComponent(REDACTED), REDACTED),
    );
  });

  it('is a no-op when disabled', () => {
    const raw = makeRedactor(buildMatchers(FAKE_IDS), false);
    expect(raw.text('janedoe')).toBe('janedoe');
    expect(raw.header('authorization', 'x')).toBe('x');
  });
});

describe('leaf', () => {
  it('redacts secret headers and fields, masks ids, keeps the rest', () => {
    expect(r.leaf('header:authorization', 'Bearer abc')).toBe(REDACTED);
    expect(r.leaf('header:cookie', 'a=b')).toBe(REDACTED);
    expect(r.leaf('a.b[].api_key', 'zzzzzz')).toBe(REDACTED);
    expect(r.leaf('o["access-token"]', 'zzzzzz')).toBe(REDACTED);
    expect(r.leaf('ctx.anonymousId', '0f8fad5b-d9cb-469f-a165-70867728950e')).toBe('0f8f…950e');
    expect(r.leaf('event', 'Build Completed')).toBe('Build Completed');
    expect(r.leaf('author', 'Some Body')).toBe('Some Body');
  });
});
