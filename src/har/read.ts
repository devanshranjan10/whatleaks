import type { Capture, CapturedRequest, HarNameValue, HarPostData, SessionMeta } from './types.js';

export class HarError extends Error {
  override name = 'HarError';
}

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

function num(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function nameValues(v: unknown): HarNameValue[] {
  if (!Array.isArray(v)) return [];
  const out: HarNameValue[] = [];
  for (const item of v) {
    if (isObj(item) && typeof item.name === 'string') out.push({ name: item.name, value: str(item.value) });
  }
  return out;
}

function headerValue(headers: HarNameValue[], name: string): string | undefined {
  const lower = name.toLowerCase();
  return headers.find((h) => h.name.toLowerCase() === lower)?.value;
}

/** Recover the request body bytes from whichever shape the HAR producer used. */
function postDataBytes(pd: unknown): { bytes: Uint8Array; mimeType: string } {
  if (!isObj(pd)) return { bytes: new Uint8Array(), mimeType: '' };
  const post = pd as Partial<HarPostData>;
  const mimeType = str(post.mimeType);
  const hasParams = Array.isArray(post.params) && post.params.length > 0;
  // mitmproxy writes both `params` and an empty `text`; prefer whichever carries data.
  if (typeof post.text === 'string' && (post.text !== '' || !hasParams)) {
    const b64 = post._encoding === 'base64' || post.encoding === 'base64';
    return { bytes: b64 ? Buffer.from(post.text, 'base64') : Buffer.from(post.text, 'utf8'), mimeType };
  }
  if (hasParams && Array.isArray(post.params)) {
    const form = new URLSearchParams();
    for (const p of post.params) {
      if (isObj(p) && typeof p.name === 'string') form.append(p.name, str(p.value));
    }
    return { bytes: Buffer.from(form.toString(), 'utf8'), mimeType: mimeType || 'application/x-www-form-urlencoded' };
  }
  return { bytes: new Uint8Array(), mimeType };
}

function sessionMeta(v: unknown): SessionMeta | undefined {
  if (!isObj(v) || v.schema !== 'whatleaks/capture@1') return undefined;
  const arr = (x: unknown): never[] => (Array.isArray(x) ? (x as never[]) : []);
  return {
    ...(v as unknown as SessionMeta),
    command: arr(v.command),
    optOutEnv: arr(v.optOutEnv),
    refused: arr(v.refused),
    passthrough: arr(v.passthrough),
    direct: arr(v.direct),
    notes: arr(v.notes),
  };
}

/**
 * Parse HAR text from whatleaks or any other producer (browser devtools, mitmproxy,
 * Proxyman, Charles, HTTP Toolkit). Structural problems throw `HarError` naming the
 * field; a malformed individual entry is skipped and listed in `warnings`.
 */
export function parseHar(text: string): Capture {
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch (err) {
    throw new HarError(`not valid JSON: ${(err as Error).message}`);
  }
  if (!isObj(root) || !isObj(root.log)) throw new HarError('missing "log" object');
  const log = root.log;
  if (!Array.isArray(log.entries)) throw new HarError('"log.entries" must be an array');

  const creator = isObj(log.creator)
    ? { name: str(log.creator.name, 'unknown'), version: str(log.creator.version) }
    : { name: 'unknown', version: '' };
  const meta = sessionMeta(log._whatleaks);
  const warnings: string[] = [];
  const parsed: Omit<CapturedRequest, 'index' | 'offsetMs'>[] = [];

  log.entries.forEach((entry: unknown, i: number) => {
    if (!isObj(entry) || !isObj(entry.request)) {
      warnings.push(`entry ${i}: no "request" object, skipped`);
      return;
    }
    const req = entry.request;
    let url: URL;
    try {
      url = new URL(str(req.url));
    } catch {
      warnings.push(`entry ${i}: unparseable request.url ${JSON.stringify(str(req.url))}, skipped`);
      return;
    }
    const startedAt = Date.parse(str(entry.startedDateTime));
    if (Number.isNaN(startedAt)) {
      warnings.push(`entry ${i}: invalid startedDateTime, skipped`);
      return;
    }
    const headers = nameValues(req.headers);
    const { bytes, mimeType } = postDataBytes(req.postData);
    const res = isObj(entry.response) ? entry.response : {};
    const content = isObj(res.content) ? res.content : {};
    const em = isObj(entry._whatleaks) ? entry._whatleaks : {};
    const responseText =
      typeof content.text === 'string' && content.encoding !== 'base64' ? content.text : undefined;
    const ws = isObj(em.websocket)
      ? {
          sent: num(em.websocket.sent),
          samples: Array.isArray(em.websocket.samples) ? em.websocket.samples.map((s) => str(s)) : [],
        }
      : undefined;

    parsed.push({
      startedAt,
      method: str(req.method, 'GET').toUpperCase(),
      url: url.href,
      host: url.hostname.replace(/^\[|\]$/g, ''),
      port: url.port ? Number(url.port) : null,
      scheme: url.protocol.replace(/:$/, ''),
      path: url.pathname,
      headers,
      body: bytes,
      wireBodySize: typeof em.wireBodySize === 'number' ? em.wireBodySize : bytes.length,
      mimeType: mimeType || headerValue(headers, 'content-type') || '',
      status: num(res.status),
      responseHeaders: nameValues(res.headers),
      ...(responseText !== undefined ? { responseText } : {}),
      responseSize: Math.max(num(content.size), num(res.bodySize), 0),
      truncated: em.truncated === true,
      ...(typeof em.aborted === 'string' ? { aborted: em.aborted } : {}),
      incomplete: em.incomplete === true,
      bodyIncomplete: em.bodyIncomplete === true,
      ...(ws ? { websocket: ws } : {}),
    });
  });

  parsed.sort((a, b) => a.startedAt - b.startedAt);
  const metaStart = meta ? Date.parse(meta.startedAt) : Number.NaN;
  const metaEnd = meta ? Date.parse(meta.endedAt) : Number.NaN;
  const firstAt = parsed[0]?.startedAt ?? 0;
  const lastAt = parsed.at(-1)?.startedAt ?? firstAt;
  const startedAt = Number.isNaN(metaStart) ? firstAt : Math.min(metaStart, firstAt || metaStart);
  const endedAt = Number.isNaN(metaEnd) ? lastAt : Math.max(metaEnd, lastAt);

  return {
    source: meta ? 'whatleaks' : 'har',
    creator,
    startedAt,
    endedAt,
    ...(meta ? { meta } : {}),
    requests: parsed.map((r, index) => ({ ...r, index, offsetMs: r.startedAt - startedAt })),
    warnings,
  };
}

export function header(headers: HarNameValue[], name: string): string | undefined {
  return headerValue(headers, name);
}
