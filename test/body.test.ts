import { gzipSync, deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { decodeBody, extractStrings } from '../src/analyze/body.js';

const b = (s: string): Uint8Array => Buffer.from(s, 'utf8');

describe('decodeBody', () => {
  it('handles empty bodies', () => {
    expect(decodeBody(new Uint8Array())).toEqual({ format: 'empty', size: 0 });
  });

  it('parses JSON by content type or by sniffing', () => {
    expect(decodeBody(b('{"a":[1,2]}'), 'application/json').value).toEqual({ a: [1, 2] });
    // sendBeacon-style JSON with a text/plain content type.
    const sniffed = decodeBody(b(' [{"e":"x"}] '), 'text/plain;charset=UTF-8');
    expect(sniffed.format).toBe('json');
    expect(sniffed.value).toEqual([{ e: 'x' }]);
  });

  it('parses NDJSON', () => {
    const r = decodeBody(b('{"a":1}\n{"b":2}\n'), 'application/x-ndjson');
    expect(r.format).toBe('ndjson');
    expect(r.value).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it('parses forms and expands JSON-valued fields', () => {
    const r = decodeBody(b('data=%7B%22event%22%3A%22open%22%7D&v=1&v=2'), 'application/x-www-form-urlencoded');
    expect(r.format).toBe('form');
    expect(r.value).toEqual({ data: { event: 'open' }, v: ['1', '2'] });
    // Sniffed without a content type.
    expect(decodeBody(b('cid=1&en=page_view')).format).toBe('form');
  });

  it('inflates gzip, zlib bodies that were not decoded upstream', () => {
    const gz = decodeBody(gzipSync(b('{"z":true}')), 'application/json');
    expect(gz).toMatchObject({ format: 'json', inflated: 'gzip', value: { z: true } });
    expect(decodeBody(deflateSync(b('{"d":1}'))).value).toEqual({ d: 1 });
  });

  it('falls back to text for non-structured text', () => {
    expect(decodeBody(b('hello world'), 'text/plain')).toMatchObject({ format: 'text', text: 'hello world' });
    // Broken JSON stays text.
    expect(decodeBody(b('{"a":'), 'application/json').format).toBe('text');
  });

  it('extracts printable strings from binary (protobuf-like) bodies', () => {
    const proto = Buffer.concat([Buffer.from([0x0a, 0x0c]), b('machine-abc123'), Buffer.from([0x12, 0x00, 0xff, 0x01]), b('darwin-arm64'), Buffer.from([0x00])]);
    const r = decodeBody(proto, 'application/x-protobuf');
    expect(r.format).toBe('binary');
    expect(r.strings).toEqual(['machine-abc123', 'darwin-arm64']);
  });

  it('caps the number of extracted strings', () => {
    const many = Buffer.concat(Array.from({ length: 100 }, (_, i) => Buffer.concat([b(`string${String(i).padStart(3, '0')}`), Buffer.from([0])])));
    expect(extractStrings(many)).toHaveLength(60);
  });
});
