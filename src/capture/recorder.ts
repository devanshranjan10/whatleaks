import type { EntryMeta, HarEntry, HarNameValue, PassthroughHost, RefusedHost } from '../har/types.js';

export const MAX_REQUEST_BODY = 1024 * 1024;
export const MAX_RESPONSE_TEXT = 64 * 1024;
const MAX_WS_SAMPLES = 3;
const MAX_WS_SAMPLE_CHARS = 2000;

export interface RecordedRequest {
  id: string;
  method: string;
  url: string;
  httpVersion: string;
  headers: Array<[string, string]>;
  /** Content-decoded body when decoding succeeded, else the raw bytes. */
  body: Uint8Array;
  wireBodySize: number;
  /** The content-encoding removed from `body`, if any. */
  decodedFrom?: string;
  /** Epoch ms. */
  startedAt: number;
  websocket?: boolean;
  /** The body was cut (over the capture limit) before it reached the recorder. */
  truncated?: boolean;
}

export interface RecordedResponse {
  id: string;
  status: number;
  statusText: string;
  httpVersion: string;
  headers: Array<[string, string]>;
  /** Decoded body, if available. Kept only when text-like and small. */
  body?: Uint8Array;
  bodySize: number;
  endedAt: number;
}

interface Pending {
  req: RecordedRequest;
  /** Only the headers were seen so far. */
  bodyPending?: boolean;
  res?: RecordedResponse;
  aborted?: string;
  ws?: { sent: number; samples: string[] };
}

const utf8 = new TextDecoder('utf-8', { fatal: true });

function isText(bytes: Uint8Array): string | undefined {
  try {
    const s = utf8.decode(bytes);
    // eslint-disable-next-line no-control-regex
    return /[\u0000-\u0008\u000e-\u001f]/.test(s) ? undefined : s;
  } catch {
    return undefined;
  }
}

function headerList(raw: Array<[string, string]>): HarNameValue[] {
  return raw.map(([name, value]) => ({ name, value }));
}

function headerOf(raw: Array<[string, string]>, name: string): string | undefined {
  const lower = name.toLowerCase();
  return raw.find(([n]) => n.toLowerCase() === lower)?.[1];
}

function bump<T extends { count: number; lastAt: string }>(map: Map<string, T>, key: string, make: () => T): void {
  const existing = map.get(key);
  if (existing) {
    existing.count++;
    existing.lastAt = new Date().toISOString();
  } else {
    map.set(key, make());
  }
}

/** Collects proxy events and turns them into HAR entries. Has no mockttp dependency. */
export class Recorder {
  private readonly pending = new Map<string, Pending>();
  private readonly order: string[] = [];
  private readonly refusedHosts = new Map<string, RefusedHost>();
  private readonly passthroughHosts = new Map<string, PassthroughHost>();

  constructor(private readonly now: () => number = Date.now) {}

  /** Headers arrived; the body may never complete if the client gives up. */
  initiated(req: Omit<RecordedRequest, 'body' | 'wireBodySize'>): void {
    if (this.pending.has(req.id)) return;
    this.pending.set(req.id, { req: { ...req, body: new Uint8Array(), wireBodySize: 0 }, bodyPending: true });
    this.order.push(req.id);
  }

  request(input: RecordedRequest): void {
    // Keep at most MAX_REQUEST_BODY bytes in memory; the rest is only counted.
    const req = input.body.length > MAX_REQUEST_BODY ? { ...input, body: input.body.subarray(0, MAX_REQUEST_BODY), truncated: true } : input;
    const existing = this.pending.get(req.id);
    if (existing) {
      existing.req = req;
      existing.bodyPending = false;
      if (req.websocket && !existing.ws) existing.ws = { sent: 0, samples: [] };
      return;
    }
    this.pending.set(req.id, { req, ...(req.websocket ? { ws: { sent: 0, samples: [] } } : {}) });
    this.order.push(req.id);
  }

  response(res: RecordedResponse): void {
    const p = this.pending.get(res.id);
    // Only small response bodies are kept (as text); large ones are dropped at once.
    if (p) p.res = res.body && res.body.length > MAX_RESPONSE_TEXT ? { ...res, body: undefined } : res;
  }

  abort(id: string, reason: string): void {
    const p = this.pending.get(id);
    if (p && !p.res) p.aborted = reason;
  }

  /** A message the app sent over a WebSocket. */
  websocketMessage(streamId: string, content: Uint8Array, isBinary: boolean): void {
    const ws = this.pending.get(streamId)?.ws;
    if (!ws) return;
    ws.sent++;
    if (ws.samples.length < MAX_WS_SAMPLES) {
      const text = isBinary ? undefined : isText(content);
      ws.samples.push(text !== undefined ? text.slice(0, MAX_WS_SAMPLE_CHARS) : `‹binary, ${content.length} bytes›`);
    }
  }

  tlsRefused(host: string, cause: string): void {
    const at = new Date(this.now()).toISOString();
    bump(this.refusedHosts, host, () => ({ host, count: 1, cause, firstAt: at, lastAt: at }));
  }

  passthrough(host: string, port: number): void {
    const at = new Date(this.now()).toISOString();
    bump(this.passthroughHosts, `${host}:${port}`, () => ({ host, port, count: 1, firstAt: at, lastAt: at }));
  }

  /** Requests seen whose response has not arrived and that were not aborted. */
  inFlight(): number {
    let n = 0;
    for (const p of this.pending.values()) if (!p.res && !p.aborted && !p.ws) n++;
    return n;
  }

  refused(): RefusedHost[] {
    return [...this.refusedHosts.values()];
  }

  passthroughs(): PassthroughHost[] {
    return [...this.passthroughHosts.values()];
  }

  entries(): HarEntry[] {
    return this.order.map((id) => this.entry(this.pending.get(id)!));
  }

  private entry(p: Pending): HarEntry {
    const { req, res } = p;
    const url = new URL(req.url);
    const truncated = req.truncated === true;
    const body = req.body;
    const mimeType = headerOf(req.headers, 'content-type') ?? '';
    let postData: HarEntry['request']['postData'];
    if (body.length > 0) {
      const text = isText(body);
      postData = text !== undefined ? { mimeType, text } : { mimeType, text: Buffer.from(body).toString('base64'), _encoding: 'base64' };
    }
    const resMime = res ? (headerOf(res.headers, 'content-type') ?? '') : '';
    const resText = res?.body && res.body.length <= MAX_RESPONSE_TEXT ? isText(res.body) : undefined;
    const meta: EntryMeta = { id: req.id, wireBodySize: req.wireBodySize };
    if (req.decodedFrom) meta.decoded = req.decodedFrom;
    if (truncated) meta.truncated = true;
    if (p.aborted) meta.aborted = p.aborted;
    if (!res && !p.aborted && !p.ws) meta.incomplete = true;
    if (p.bodyPending) meta.bodyIncomplete = true;
    if (p.ws) meta.websocket = p.ws;
    const wait = res ? Math.max(0, res.endedAt - req.startedAt) : 0;
    return {
      startedDateTime: new Date(req.startedAt).toISOString(),
      time: wait,
      request: {
        method: req.method,
        url: req.url,
        httpVersion: req.httpVersion,
        cookies: [],
        headers: headerList(req.headers),
        queryString: [...url.searchParams].map(([name, value]) => ({ name, value })),
        ...(postData ? { postData } : {}),
        headersSize: -1,
        bodySize: req.wireBodySize,
      },
      response: {
        status: res?.status ?? 0,
        statusText: res?.statusText ?? '',
        httpVersion: res?.httpVersion ?? '',
        cookies: [],
        headers: res ? headerList(res.headers) : [],
        content: { size: res?.bodySize ?? 0, mimeType: resMime, ...(resText !== undefined ? { text: resText } : {}) },
        redirectURL: '',
        headersSize: -1,
        bodySize: res?.bodySize ?? -1,
      },
      cache: {},
      timings: { send: 0, wait, receive: 0 },
      _whatleaks: meta,
    };
  }
}
