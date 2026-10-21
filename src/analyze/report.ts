import type { HostRule } from '../catalog/hosts.js';
import type { Capture, CapturedRequest } from '../har/types.js';
import type {
  Category,
  Destination,
  Endpoint,
  Finding,
  FindingKind,
  Report,
  IdValue,
  Sample,
} from '../model.js';
import { TELEMETRY_CATEGORIES } from '../model.js';
import { type DecodedBody, decodeBody } from './body.js';
import { categoryRank, classify } from './classify.js';
import { FieldAccumulator, flatten, isIdLike, type Leaf } from './fields.js';
import { IDENTITY_TITLES, type Matcher, findEmails, findPaths, fingerprint, scanIdentity } from './identity.js';
import { type Redactor, isSecretName, makeRedactor } from './redact.js';
import { queryParamNames, templatePath } from './url.js';

export interface ReportOptions {
  matchers: Matcher[];
  /** Payload samples per endpoint. Default 2. */
  samples?: number;
  /** Turn redaction off. */
  raw?: boolean;
  rules?: readonly HostRule[];
  /** Label when the capture has no whatleaks metadata (e.g. the HAR file name). */
  label?: string;
}

const SAMPLE_CHARS = 4000;
const TEXT_LEAF_CHARS = 200;
const TIMELINE_BUCKETS = 20;
const MAX_LOCATIONS = 8;
const MAX_IDS = 500;

/** Headers every client sends; they are not "fields" of the payload. */
const STANDARD_HEADERS = new Set([
  'host', 'content-type', 'content-length', 'accept', 'accept-encoding', 'accept-language', 'connection',
  'user-agent', 'content-encoding', 'transfer-encoding', 'cache-control', 'pragma', 'origin', 'referer', 'te',
  'upgrade', 'proxy-connection', 'keep-alive', 'expect', 'date', 'if-none-match', 'if-modified-since', 'priority',
  'sec-websocket-key', 'sec-websocket-version', 'sec-websocket-extensions', 'sec-websocket-protocol',
]);

const FINDING_META: Record<Exclude<FindingKind, keyof typeof IDENTITY_TITLES>, { title: string; severity: Finding['severity'] }> = {
  email: { title: 'An email address', severity: 'high' },
  'file-path': { title: 'Absolute file paths', severity: 'medium' },
  'stable-id': { title: 'Repeated identifiers', severity: 'medium' },
};

function displayHost(req: CapturedRequest): string {
  const defaultPort = req.scheme === 'https' || req.scheme === 'wss' ? 443 : 80;
  return req.port !== null && req.port !== defaultPort ? `${req.host}:${req.port}` : req.host;
}

function isStandardHeader(name: string): boolean {
  const n = name.toLowerCase();
  return STANDARD_HEADERS.has(n) || n.startsWith(':') || n.startsWith('sec-ch-') || n.startsWith('sec-fetch-');
}

function requestLeaves(req: CapturedRequest, body: DecodedBody): Leaf[] {
  const leaves: Leaf[] = [];
  try {
    for (const [name, value] of new URL(req.url).searchParams) leaves.push({ path: `?${name}`, value });
  } catch {
    // URL already validated by the reader.
  }
  for (const h of req.headers) {
    if (!isStandardHeader(h.name)) leaves.push({ path: `header:${h.name.toLowerCase()}`, value: h.value });
  }
  if (body.format === 'json' || body.format === 'ndjson' || body.format === 'form') {
    leaves.push(...flatten(body.value));
  } else if (body.format === 'text' && body.text !== undefined) {
    leaves.push({ path: 'body', value: body.text.slice(0, TEXT_LEAF_CHARS) });
  } else if (body.format === 'binary') {
    for (const s of body.strings ?? []) leaves.push({ path: 'body:strings', value: s });
  }
  return leaves;
}

/** Every string whitelisted for identity scanning, with where it came from. */
function scanTargets(req: CapturedRequest, body: DecodedBody, leaves: Leaf[]): Array<[location: string, text: string]> {
  const out: Array<[string, string]> = [];
  let url = req.url;
  try {
    url = decodeURIComponent(req.url);
  } catch {
    // keep as-is
  }
  out.push(['url', url]);
  for (const h of req.headers) out.push([`header:${h.name.toLowerCase()}`, h.value]);
  if (body.format === 'text' && body.text !== undefined) out.push(['body', body.text]);
  for (const leaf of leaves) {
    if (typeof leaf.value === 'string' && !leaf.path.startsWith('?') && !leaf.path.startsWith('header:')) {
      out.push([leaf.path, leaf.value]);
    }
  }
  return out;
}

function approxBytes(req: CapturedRequest): number {
  let n = req.method.length + req.url.length + 12;
  for (const h of req.headers) n += h.name.length + h.value.length + 4;
  return n + 2 + req.wireBodySize;
}

function truncate(text: string, max: number): { text: string; truncated: boolean } {
  if (text.length <= max) return { text, truncated: false };
  const cut = text.lastIndexOf('\n', max);
  const end = cut > max * 0.6 ? cut : max;
  return { text: `${text.slice(0, end)}\n… (${text.length - end} more characters)`, truncated: true };
}

function sampleBody(body: DecodedBody, redactor: Redactor): string {
  switch (body.format) {
    case 'empty':
      return '';
    case 'json':
    case 'ndjson':
    case 'form':
      return JSON.stringify(redactor.value(body.value), null, 2);
    case 'text':
      return redactor.text(body.text ?? '');
    case 'binary': {
      const strings = (body.strings ?? []).map((s) => redactor.text(s));
      return `‹binary, ${body.size} bytes›${strings.length ? `\nprintable strings: ${strings.join(' | ')}` : ''}`;
    }
  }
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

interface EndpointAcc {
  ep: Omit<Endpoint, 'fields' | 'medianGapMs' | 'perMinute'>;
  fields: FieldAccumulator;
  times: number[];
  userAgents: Set<string>;
  queryParams: Set<string>;
}

interface FindingAcc {
  forms: Set<string>;
  requests: Set<number>;
  endpoints: Set<string>;
  locations: Set<string>;
}

export function buildReport(capture: Capture, opts: ReportOptions): Report {
  const samplesPerEndpoint = opts.samples ?? 2;
  const redactor = makeRedactor(opts.matchers, !opts.raw);
  const endpoints = new Map<string, EndpointAcc>();
  const findings = new Map<FindingKind, FindingAcc>();
  const ids = new Map<string, { requests: Set<number>; endpoints: Set<string>; locations: Set<string> }>();
  const durationMs = Math.max(0, capture.endedAt - capture.startedAt);
  const timeline = new Array<number>(TIMELINE_BUCKETS).fill(0);
  let truncatedBodies = 0;
  let unfinished = 0;
  let cutOff = 0;

  const note = (kind: FindingKind, req: number, key: string, location: string, form: string): void => {
    let f = findings.get(kind);
    if (!f) {
      f = { forms: new Set(), requests: new Set(), endpoints: new Set(), locations: new Set() };
      findings.set(kind, f);
    }
    f.forms.add(form);
    f.requests.add(req);
    f.endpoints.add(key);
    f.locations.add(location);
  };

  for (const req of capture.requests) {
    const host = displayHost(req);
    const pathTemplate = templatePath(req.path);
    const key = `${req.method} ${host}${pathTemplate}`;
    const body = decodeBody(req.body, req.mimeType);
    const leaves = requestLeaves(req, body);

    let acc = endpoints.get(key);
    if (!acc) {
      acc = {
        ep: {
          key,
          method: req.method,
          host,
          pathTemplate,
          classification: classify(req.host, req.path, opts.rules),
          count: 0,
          firstMs: req.offsetMs,
          lastMs: req.offsetMs,
          bodyBytes: 0,
          approxBytes: 0,
          statuses: {},
          bodyFormats: {},
          queryParams: [],
          userAgents: [],
          samples: [],
          websocketMessages: 0,
        },
        fields: new FieldAccumulator((p, v) => redactor.leaf(p, v), (s) => redactor.text(s)),
        times: [],
        userAgents: new Set(),
        queryParams: new Set(),
      };
      endpoints.set(key, acc);
    }
    const ep = acc.ep;
    ep.count++;
    ep.lastMs = Math.max(ep.lastMs, req.offsetMs);
    ep.firstMs = Math.min(ep.firstMs, req.offsetMs);
    ep.bodyBytes += req.wireBodySize;
    ep.approxBytes += approxBytes(req);
    const status = req.incomplete ? 'incomplete' : req.aborted ? 'aborted' : String(req.status);
    ep.statuses[status] = (ep.statuses[status] ?? 0) + 1;
    ep.bodyFormats[body.format] = (ep.bodyFormats[body.format] ?? 0) + 1;
    ep.websocketMessages += req.websocket?.sent ?? 0;
    acc.times.push(req.offsetMs);
    for (const q of queryParamNames(req.url)) acc.queryParams.add(q);
    const ua = req.headers.find((h) => h.name.toLowerCase() === 'user-agent')?.value;
    if (ua && acc.userAgents.size < 3) acc.userAgents.add(redactor.text(ua));
    acc.fields.add(req.index, leaves);
    if (req.truncated) truncatedBodies++;
    if (req.incomplete || req.aborted) unfinished++;
    if (req.bodyIncomplete) cutOff++;

    const bucket = durationMs > 0 ? Math.min(TIMELINE_BUCKETS - 1, Math.floor((req.offsetMs / durationMs) * TIMELINE_BUCKETS)) : 0;
    timeline[Math.max(0, bucket)]!++;

    const hasPayload = body.format !== 'empty' || acc.queryParams.size > 0 || (req.websocket?.samples.length ?? 0) > 0;
    if (ep.samples.length < samplesPerEndpoint && hasPayload) {
      let text = sampleBody(body, redactor);
      if (req.websocket?.samples.length) {
        text += `${text ? '\n' : ''}websocket messages sent: ${req.websocket.sent}\n${req.websocket.samples.map((s) => redactor.text(s)).join('\n')}`;
      }
      const t = truncate(text, SAMPLE_CHARS);
      const sample: Sample = { offsetMs: req.offsetMs, url: redactor.url(req.url), format: body.format, body: t.text, truncated: t.truncated || req.truncated };
      ep.samples.push(sample);
    }

    // Identity and generic detectors.
    for (const [location, text] of scanTargets(req, body, leaves)) {
      const secretLocation = isSecretName(location.replace(/^header:/, '')) || location === 'header:cookie';
      const { hits, rest } = scanIdentity(text, opts.matchers);
      for (const h of hits) note(h.kind, req.index, key, redactor.text(location), h.form);
      if (secretLocation) continue;
      if (findEmails(rest).length > 0) note('email', req.index, key, redactor.text(location), 'raw');
      if (findPaths(rest).length > 0) note('file-path', req.index, key, redactor.text(location), 'raw');
    }
    for (const leaf of leaves) {
      if (!isIdLike(leaf.value) || isSecretName(leaf.path.replace(/^header:|^\?/, ''))) continue;
      const v = String(leaf.value);
      let entry = ids.get(v);
      if (!entry) {
        entry = { requests: new Set(), endpoints: new Set(), locations: new Set() };
        ids.set(v, entry);
      }
      entry.requests.add(req.index);
      entry.endpoints.add(key);
      entry.locations.add(redactor.text(leaf.path));
    }
  }

  const endpointList: Endpoint[] = [...endpoints.values()].map(({ ep, fields, times, userAgents, queryParams }) => {
    const sorted = [...times].sort((a, b) => a - b);
    const gaps = sorted.slice(1).map((t, i) => t - sorted[i]!);
    return {
      ...ep,
      queryParams: [...queryParams].sort(),
      userAgents: [...userAgents],
      fields: fields.result(),
      medianGapMs: median(gaps),
      perMinute: durationMs >= 60_000 ? Math.round((ep.count / (durationMs / 60_000)) * 10) / 10 : null,
    };
  });
  endpointList.sort(
    (a, b) =>
      categoryRank(b.classification.category) - categoryRank(a.classification.category) ||
      b.count - a.count ||
      a.key.localeCompare(b.key),
  );

  const destMap = new Map<string, Destination>();
  for (const ep of endpointList) {
    let d = destMap.get(ep.host);
    if (!d) {
      d = { host: ep.host, category: ep.classification.category, requests: 0, approxBytes: 0, endpoints: [] };
      destMap.set(ep.host, d);
    }
    d.requests += ep.count;
    d.approxBytes += ep.approxBytes;
    d.endpoints.push(ep.key);
    if (categoryRank(ep.classification.category) > categoryRank(d.category)) d.category = ep.classification.category;
  }
  const destinations = [...destMap.values()].sort(
    (a, b) => categoryRank(b.category) - categoryRank(a.category) || b.requests - a.requests || a.host.localeCompare(b.host),
  );

  const idList: IdValue[] = [...ids.entries()]
    .map(([value, e]) => ({
      fingerprint: fingerprint(value),
      display: redactor.leaf('id', value),
      requests: e.requests.size,
      endpoints: [...e.endpoints].sort(),
      locations: [...e.locations].slice(0, MAX_LOCATIONS),
    }))
    .sort((a, b) => b.requests - a.requests || a.fingerprint.localeCompare(b.fingerprint))
    .slice(0, MAX_IDS);
  const repeated = idList.filter((x) => x.requests >= 2);
  if (repeated.length > 0) {
    const f: FindingAcc = { forms: new Set(['raw']), requests: new Set(), endpoints: new Set(), locations: new Set() };
    for (const [, e] of [...ids.entries()].filter(([, x]) => x.requests.size >= 2)) {
      e.requests.forEach((r) => f.requests.add(r));
      e.endpoints.forEach((x) => f.endpoints.add(x));
      e.locations.forEach((x) => f.locations.add(x));
    }
    findings.set('stable-id', f);
  }

  const findingList: Finding[] = [...findings.entries()]
    .map(([kind, f]) => {
      const meta =
        kind in IDENTITY_TITLES
          ? { title: IDENTITY_TITLES[kind as keyof typeof IDENTITY_TITLES], severity: 'high' as const }
          : FINDING_META[kind as keyof typeof FINDING_META];
      return {
        kind,
        severity: meta.severity,
        title: meta.title,
        forms: [...f.forms].sort(),
        requests: f.requests.size,
        endpoints: [...f.endpoints].sort(),
        locations: [...f.locations].slice(0, MAX_LOCATIONS),
      };
    })
    .sort((a, b) => (a.severity === b.severity ? b.requests - a.requests : a.severity === 'high' ? -1 : 1));

  const meta = capture.meta;
  const refused = meta?.refused ?? [];
  const caveats: string[] = [];
  if (capture.source === 'har') {
    caveats.push(
      `Imported from ${capture.creator.name}: only what that tool recorded is included, and identifiers are matched against this machine.`,
    );
  }
  if (refused.length > 0) {
    const conns = refused.reduce((n, r) => n + r.count, 0);
    caveats.push(
      `${conns} connection${conns === 1 ? '' : 's'} to ${refused.length} host${refused.length === 1 ? '' : 's'} did not accept the whatleaks certificate, so their contents are not in this report.`,
    );
  }
  if (meta?.watcher === 'unavailable') {
    caveats.push('Direct-connection watching was unavailable, so traffic that bypassed the proxy is not listed.');
  }
  if (truncatedBodies > 0) caveats.push(`${truncatedBodies} request bod${truncatedBodies === 1 ? 'y was' : 'ies were'} cut at the 1 MiB storage cap.`);
  if (unfinished > 0) caveats.push(`${unfinished} request${unfinished === 1 ? '' : 's'} did not complete (aborted, or still in flight when capture stopped).`);
  if (cutOff > 0) caveats.push(`${cutOff} request${cutOff === 1 ? ' was' : 's were'} cut off before ${cutOff === 1 ? 'its' : 'their'} body finished uploading, so ${cutOff === 1 ? 'its' : 'their'} content is missing.`);
  for (const w of capture.warnings) caveats.push(`HAR: ${w}`);
  for (const n of meta?.notes ?? []) caveats.push(n);

  const isTelemetry = (c: Category): boolean => TELEMETRY_CATEGORIES.includes(c);
  return {
    schema: 'whatleaks/report@1',
    capture: {
      label: meta?.label ?? opts.label ?? 'capture',
      command: meta?.command ?? [],
      startedAt: new Date(capture.startedAt).toISOString(),
      durationMs,
      exitCode: meta?.exitCode ?? null,
      stoppedBy: meta?.stoppedBy ?? null,
      source: capture.source,
      creator: `${capture.creator.name}${capture.creator.version ? ` ${capture.creator.version}` : ''}`,
      optOutEnv: meta?.optOutEnv ?? [],
    },
    totals: {
      requests: capture.requests.length,
      destinations: destinations.length,
      endpoints: endpointList.length,
      approxBytes: endpointList.reduce((n, e) => n + e.approxBytes, 0),
      telemetryRequests: endpointList.filter((e) => isTelemetry(e.classification.category)).reduce((n, e) => n + e.count, 0),
      refusedConnections: refused.reduce((n, r) => n + r.count, 0),
      directConnections: meta?.direct.length ?? 0,
    },
    destinations,
    endpoints: endpointList,
    findings: findingList,
    ids: idList,
    refused,
    passthrough: meta?.passthrough ?? [],
    direct: meta?.direct ?? [],
    timeline,
    caveats,
    redacted: !opts.raw,
  };
}
