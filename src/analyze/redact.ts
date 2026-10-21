import { isIdLike } from './fields.js';
import { findEmails, maskId, type Matcher } from './identity.js';

/** Header names whose values are credentials. */
const SECRET_HEADERS = new Set([
  'authorization', 'proxy-authorization', 'cookie', 'set-cookie', 'x-api-key', 'api-key', 'apikey',
  'x-auth-token', 'x-access-token', 'x-csrf-token', 'x-xsrf-token', 'x-amz-security-token',
  'private-token', 'x-goog-api-key', 'x-sentry-auth',
]);
const SECRET_NAME = /(pass(word|wd)?|secret|token|api[-_]?key|apikey|auth(?!or(s|ity)?\b)|credential|private[-_]?key|session[-_]?key|signature|^sig$|access[-_]?key|cookie|dsn)/i;

export const REDACTED = '‹redacted›';

export function isSecretName(name: string): boolean {
  return SECRET_NAME.test(name);
}

/** Last key of a field path: `a.b[].c` → `c`, `header:x-key` → `x-key`, `?q` → `q`. */
export function leafKey(path: string): string {
  const p = path.replace(/^header:|^\?/, '').replace(/\[\]$/, '');
  const quoted = /\["([^"]*)"\]$|^"([^"]*)"$/.exec(p);
  if (quoted) return quoted[1] ?? quoted[2] ?? p;
  return p.split(/[.[\]]/).filter(Boolean).at(-1) ?? p;
}

export interface Redactor {
  readonly enabled: boolean;
  text(s: string): string;
  /** Display form of one field value at `path`: secrets redacted, identifiers labelled, ids masked. */
  leaf(path: string, value: string): string;
  header(name: string, value: string): string;
  /** Redact a JSON-ish value; string values under secret-looking keys are replaced. */
  value(v: unknown): unknown;
  url(u: string): string;
}

function labelFor(m: Matcher): string {
  return m.form === 'raw' || m.form === 'json-escaped' || m.form === 'url-encoded' || m.form === 'no-separators'
    ? `‹${m.kind}›`
    : `‹${m.form}(${m.kind})›`;
}

function replaceAllInsensitive(text: string, needle: string, replacement: string): string {
  const lower = text.toLowerCase();
  let out = '';
  let from = 0;
  for (;;) {
    const at = lower.indexOf(needle, from);
    if (at === -1) break;
    out += text.slice(from, at) + replacement;
    from = at + needle.length;
  }
  return out + text.slice(from);
}

export function makeRedactor(matchers: Matcher[], enabled = true): Redactor {
  // Longer needles first so a home path is replaced before the username inside it.
  const ordered = [...matchers].sort((a, b) => b.needle.length - a.needle.length);

  const text = (s: string): string => {
    if (!enabled || s === '') return s;
    let out = s;
    for (const m of ordered) {
      if (out.toLowerCase().includes(m.needle)) out = replaceAllInsensitive(out, m.needle, labelFor(m));
    }
    for (const email of new Set(findEmails(out))) out = out.split(email).join('‹email›');
    return out;
  };

  const scalar = (key: string, v: string): string => {
    if (key && isSecretName(key) && v.length >= 4) return REDACTED;
    const t = text(v);
    // App-generated ids (install ids, session ids) would link a shared report to its author.
    return isIdLike(t) ? maskId(t) : t;
  };

  const value = (v: unknown, key = ''): unknown => {
    if (!enabled) return v;
    if (typeof v === 'string') return scalar(key, v);
    if (Array.isArray(v)) return v.map((x) => value(x, key));
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, child] of Object.entries(v as Record<string, unknown>)) out[text(k)] = value(child, k);
      return out;
    }
    return v;
  };

  const url = (u: string): string => {
    if (!enabled) return u;
    let parsed: URL;
    try {
      parsed = new URL(u);
    } catch {
      return text(u);
    }
    for (const [k, v] of [...parsed.searchParams]) {
      const shown = scalar(k, v);
      if (shown !== v) parsed.searchParams.set(k, shown);
    }
    let out = parsed.href;
    try {
      out = decodeURI(out);
    } catch {
      // keep encoded
    }
    return text(out);
  };

  return {
    enabled,
    text,
    leaf: (path, v) => {
      if (!enabled) return v;
      if (path.startsWith('header:') && SECRET_HEADERS.has(path.slice(7))) return REDACTED;
      return scalar(leafKey(path), v);
    },
    header: (name, v) => (enabled && (SECRET_HEADERS.has(name.toLowerCase()) || (isSecretName(name) && v.length >= 4)) ? REDACTED : text(v)),
    value: (v) => value(v),
    url,
  };
}
