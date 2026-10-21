import type { EntryMeta, Har, HarEntry, SessionMeta } from '../../src/har/types.js';

export const T0 = Date.parse('2026-10-21T10:00:00.000Z');

export interface EntrySpec {
  /** Offset from T0 in ms. */
  at: number;
  method?: string;
  url: string;
  body?: string | object | Uint8Array;
  contentType?: string;
  headers?: Record<string, string>;
  status?: number;
  responseText?: string;
  meta?: EntryMeta;
}

export function entry(spec: EntrySpec, start = T0): HarEntry {
  const headers = Object.entries(spec.headers ?? {}).map(([name, value]) => ({ name, value }));
  let postData: HarEntry['request']['postData'];
  let bodySize = 0;
  if (spec.body !== undefined) {
    if (spec.body instanceof Uint8Array) {
      postData = { mimeType: spec.contentType ?? 'application/octet-stream', text: Buffer.from(spec.body).toString('base64'), _encoding: 'base64' };
      bodySize = spec.body.length;
    } else {
      const text = typeof spec.body === 'string' ? spec.body : JSON.stringify(spec.body);
      postData = { mimeType: spec.contentType ?? (typeof spec.body === 'string' ? 'text/plain' : 'application/json'), text };
      bodySize = Buffer.byteLength(text);
    }
    if (!headers.some((h) => h.name.toLowerCase() === 'content-type')) headers.push({ name: 'content-type', value: postData.mimeType });
  }
  const url = new URL(spec.url);
  return {
    startedDateTime: new Date(start + spec.at).toISOString(),
    time: 10,
    request: {
      method: spec.method ?? (spec.body === undefined ? 'GET' : 'POST'),
      url: spec.url,
      httpVersion: 'HTTP/1.1',
      cookies: [],
      headers: [{ name: 'host', value: url.host }, ...headers],
      queryString: [...url.searchParams].map(([name, value]) => ({ name, value })),
      ...(postData ? { postData } : {}),
      headersSize: -1,
      bodySize,
    },
    response: {
      status: spec.status ?? 200,
      statusText: '',
      httpVersion: 'HTTP/1.1',
      cookies: [],
      headers: [],
      content: { size: spec.responseText?.length ?? 0, mimeType: 'text/plain', ...(spec.responseText ? { text: spec.responseText } : {}) },
      redirectURL: '',
      headersSize: -1,
      bodySize: spec.responseText?.length ?? 0,
    },
    cache: {},
    timings: { send: 0, wait: 10, receive: 0 },
    ...(spec.meta ? { _whatleaks: spec.meta } : {}),
  };
}

export function sessionMeta(over: Partial<SessionMeta> = {}, start = T0, durationMs = 60_000): SessionMeta {
  return {
    schema: 'whatleaks/capture@1',
    label: 'test',
    command: ['fake-tool', 'build'],
    cwd: '/tmp/project',
    startedAt: new Date(start).toISOString(),
    endedAt: new Date(start + durationMs).toISOString(),
    exitCode: 0,
    signal: null,
    stoppedBy: 'exit',
    platform: 'darwin',
    arch: 'arm64',
    node: 'v26.0.0',
    whatleaks: '0.1.0',
    optOutEnv: [],
    refused: [],
    passthrough: [],
    direct: [],
    watcher: 'on',
    notes: [],
    ...over,
  };
}

export function makeHar(specs: EntrySpec[], meta?: Partial<SessionMeta> | null, start = T0, durationMs = 60_000): Har {
  return {
    log: {
      version: '1.2',
      creator: { name: 'whatleaks', version: '0.1.0' },
      entries: specs.map((s) => entry(s, start)),
      ...(meta === null ? {} : { _whatleaks: sessionMeta(meta ?? {}, start, durationMs) }),
    },
  };
}

export const harText = (har: Har): string => JSON.stringify(har);
