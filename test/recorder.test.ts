import { describe, expect, it } from 'vitest';
import { MAX_REQUEST_BODY, Recorder } from '../src/capture/recorder.js';

const T = Date.parse('2026-10-21T10:00:00Z');
const req = (id: string, extra: Partial<Parameters<Recorder['request']>[0]> = {}) => ({
  id,
  method: 'POST',
  url: 'https://t.example/v1/e?x=1',
  httpVersion: '1.1',
  headers: [['content-type', 'application/json']] as Array<[string, string]>,
  body: Buffer.from('{"a":1}'),
  wireBodySize: 7,
  startedAt: T,
  ...extra,
});

describe('Recorder', () => {
  it('pairs requests and responses into HAR entries', () => {
    const r = new Recorder(() => T);
    r.request(req('1'));
    r.response({ id: '1', status: 204, statusText: 'No Content', httpVersion: '', headers: [['content-type', 'text/plain']], body: Buffer.from('ok'), bodySize: 2, endedAt: T + 40 });
    const [e] = r.entries();
    expect(e?.request).toMatchObject({ method: 'POST', url: 'https://t.example/v1/e?x=1', queryString: [{ name: 'x', value: '1' }], postData: { mimeType: 'application/json', text: '{"a":1}' }, bodySize: 7 });
    expect(e?.response).toMatchObject({ status: 204, content: { size: 2, text: 'ok' } });
    expect(e?.time).toBe(40);
    expect(e?.startedDateTime).toBe('2026-10-21T10:00:00.000Z');
    expect(r.inFlight()).toBe(0);
  });

  it('stores binary bodies as base64, truncates huge ones, records decoding', () => {
    const r = new Recorder();
    r.request(req('b', { body: new Uint8Array([0, 1, 2, 255]), wireBodySize: 3, decodedFrom: 'gzip' }));
    r.request(req('h', { body: Buffer.alloc(MAX_REQUEST_BODY + 10, 0x61) }));
    const [b, h] = r.entries();
    expect(b?.request.postData).toEqual({ mimeType: 'application/json', text: 'AAEC/w==', _encoding: 'base64' });
    expect(b?._whatleaks).toMatchObject({ decoded: 'gzip', wireBodySize: 3, incomplete: true });
    expect(h?.request.postData?.text).toHaveLength(MAX_REQUEST_BODY);
    expect(h?._whatleaks?.truncated).toBe(true);
    expect(r.inFlight()).toBe(2);
  });

  it('records aborts, websocket messages, refused and passthrough hosts', () => {
    const r = new Recorder(() => T);
    r.request(req('a'));
    r.abort('a', 'ECONNRESET');
    r.request(req('w', { method: 'GET', body: new Uint8Array(), websocket: true }));
    for (let i = 0; i < 5; i++) r.websocketMessage('w', Buffer.from(`{"n":${i}}`), false);
    r.websocketMessage('w', new Uint8Array([1, 2]), true);
    r.tlsRefused('pinned.example', 'cert-rejected');
    r.tlsRefused('pinned.example', 'cert-rejected');
    r.passthrough('bank.example', 443);
    const [a, w] = r.entries();
    expect(a?._whatleaks).toMatchObject({ aborted: 'ECONNRESET' });
    expect(a?._whatleaks?.incomplete).toBeUndefined();
    expect(w?._whatleaks?.websocket).toEqual({ sent: 6, samples: ['{"n":0}', '{"n":1}', '{"n":2}'] });
    expect(r.refused()).toEqual([{ host: 'pinned.example', count: 2, cause: 'cert-rejected', firstAt: '2026-10-21T10:00:00.000Z', lastAt: expect.any(String) as string }]);
    expect(r.passthroughs()[0]).toMatchObject({ host: 'bank.example', port: 443, count: 1 });
    expect(r.inFlight()).toBe(0);
  });
});
