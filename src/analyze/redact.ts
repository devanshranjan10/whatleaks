import { isIdLike } from './fields.js';
import { findEmails, type Matcher } from './identity.js';
import { isIdSegment } from './url.js';

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

/** True when any key along a field path names a secret (`auth.value` is under `auth`). */
function pathHasSecret(path: string): boolean {
  const p = path.replace(/^header:|^\?/, '');
  return p.split(/[.[\]"]+/).some((k) => k !== '' && isSecretName(k));
}

export interface Redactor {
  readonly enabled: boolean;
  /** Local identifiers → labels, emails → ‹email›. For short structured strings. */
  text(s: string): string;
  /** `text`, plus secrets in key=value / "key":"value" / multipart / header-line form, plus ids. */
  freeText(s: string): string;
  /** Display form of one field value at `path`. */
  leaf(path: string, value: string): string;
  /** A field path with identifiers labelled and id-shaped keys aliased. */
  path(p: string): string;
  /** A JSON-ish value: secret subtrees redacted, identifiers labelled, ids aliased. */
  value(v: unknown): unknown;
  url(u: string): string;
  /** A command line with secret flag values redacted. */
  argv(args: string[]): string[];
  /** Stable per-report alias for an id-shaped value. */
  id(v: string): string;
}

function labelFor(m: Matcher): string {
  return m.form === 'raw' || m.form === 'json-escaped' || m.form === 'url-encoded' || m.form === 'no-separators'
    ? `‹${m.kind}›`
    : `‹${m.form}(${m.kind})›`;
}

/** Replace occurrences of the matcher's needle that respect its boundary rule. */
function replaceBounded(text: string, m: Matcher, replacement: string): string {
  const { needle, boundary } = m;
  const lower = m.caseSensitive ? text : text.toLowerCase();
  let out = '';
  let from = 0;
  let at = lower.indexOf(needle);
  while (at !== -1) {
    const end = at + needle.length;
    const before = at > 0 ? text[at - 1]! : '';
    const after = end < text.length ? text[end]! : '';
    const ok = !boundary || (!(before && boundary.test(before)) && !(after && boundary.test(after)));
    if (ok) {
      out += text.slice(from, at) + replacement;
      from = end;
    }
    at = lower.indexOf(needle, end);
  }
  return out + text.slice(from);
}

const TOKEN_RUN = /[A-Za-z0-9_\-+/=.:]{16,}/g;

/**
 * Builds the redactor for one report. `aliases` can be shared between reports (diff and
 * compare) so the same id gets the same alias on both sides.
 */
export function makeRedactor(matchers: Matcher[], enabled = true, aliases: Map<string, string> = new Map()): Redactor {
  // Longer needles first so a home path is replaced before the username inside it.
  const ordered = [...matchers].sort((a, b) => b.needle.length - a.needle.length);

  const id = (v: string): string => {
    if (!enabled) return v;
    let alias = aliases.get(v);
    if (!alias) {
      alias = `‹id-${aliases.size + 1}›`;
      aliases.set(v, alias);
    }
    return alias;
  };

  const text = (s: string): string => {
    if (!enabled || s === '') return s;
    let out = s;
    for (const m of ordered) {
      if ((m.caseSensitive ? out : out.toLowerCase()).includes(m.needle)) out = replaceBounded(out, m, labelFor(m));
    }
    for (const email of new Set(findEmails(out))) out = out.split(email).join('‹email›');
    return out;
  };

  const scalar = (key: string, v: string, secret: boolean): string => {
    if ((secret || (key !== '' && isSecretName(key))) && v.length >= 4) return REDACTED;
    const t = text(v);
    // App-generated ids (install ids, session ids) would link a shared report to its author.
    return isIdLike(t) ? id(t) : t;
  };

  const key = (k: string): string => {
    const t = text(k);
    return isIdLike(t) ? id(t) : t;
  };

  const value = (v: unknown, k = '', secret = false): unknown => {
    if (!enabled) return v;
    const isSecret = secret || (k !== '' && isSecretName(k));
    if (typeof v === 'string') return scalar(k, v, isSecret);
    if (typeof v === 'number' && isSecret && String(v).length >= 4) return REDACTED;
    if (Array.isArray(v)) return v.map((x) => value(x, k, isSecret));
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const [ck, child] of Object.entries(v as Record<string, unknown>)) out[key(ck)] = value(child, ck, isSecret);
      return out;
    }
    return v;
  };

  const freeText = (s: string): string => {
    if (!enabled || s === '') return s;
    let out = text(s);
    // "secretName": "value"  and  "secretName": 12345
    // (a value cut off by the body size cap runs to the end of the text)
    out = out.replace(/("([^"\\]{1,64})"\s*:\s*)("(?:[^"\\]|\\.)*(?:"|$)|-?\d{4,})/g, (m, pre: string, name: string) =>
      isSecretName(name) ? `${pre}"${REDACTED}"` : m,
    );
    // multipart: name="password" … blank line … value
    out = out.replace(/(name="([^"]{1,64})"[^\r\n]*\r?\n(?:[^\r\n]+\r?\n)*\r?\n)([^\r\n]*)/g, (m, head: string, name: string) =>
      isSecretName(name) ? `${head}${REDACTED}` : m,
    );
    // Header lines: "Authorization: Bearer …"
    out = out.replace(/(^|\n)([A-Za-z][\w-]{1,40}):[ \t]*([^\r\n]+)/g, (m, nl: string, name: string) =>
      SECRET_HEADERS.has(name.toLowerCase()) || isSecretName(name) ? `${nl}${name}: ${REDACTED}` : m,
    );
    // secretName=value in query strings, forms and command lines
    out = out.replace(/(^|[?&\s;,"'])([\w.-]{1,64})=([^&\s;,"']{4,})/g, (m, pre: string, name: string) =>
      isSecretName(name) ? `${pre}${name}=${REDACTED}` : m,
    );
    return out.replace(TOKEN_RUN, (t) => (isIdLike(t) ? id(t) : t));
  };

  const path = (p: string): string => {
    if (!enabled) return p;
    return text(p).replace(/[^.[\]"]+/g, (seg) => (isIdLike(seg) ? id(seg) : seg));
  };

  const url = (u: string): string => {
    if (!enabled) return u;
    let parsed: URL;
    try {
      parsed = new URL(u);
    } catch {
      return freeText(u);
    }
    const segments = parsed.pathname.split('/').map((seg) => {
      let decoded = seg;
      try {
        decoded = decodeURIComponent(seg);
      } catch {
        // keep as-is
      }
      const t = text(decoded);
      if (t !== decoded) return t;
      return isIdSegment(decoded) || isIdLike(decoded) ? id(decoded) : decoded;
    });
    const query = [...parsed.searchParams].map(([k, v]) => `${key(k)}=${scalar(k, v, false)}`);
    const host = text(parsed.port ? `${parsed.hostname}:${parsed.port}` : parsed.hostname);
    return `${parsed.protocol}//${host}${segments.join('/')}${query.length ? `?${query.join('&')}` : ''}`;
  };

  const argv = (args: string[]): string[] => {
    if (!enabled) return args;
    const out: string[] = [];
    let redactNext = false;
    for (const a of args) {
      if (redactNext) {
        out.push(REDACTED);
        redactNext = false;
        continue;
      }
      const flag = /^(--?[\w.-]+)=(.*)$/.exec(a);
      if (flag && isSecretName(flag[1]!.replace(/^-+/, ''))) {
        out.push(`${flag[1]}=${REDACTED}`);
      } else if (/^--?[\w.-]+$/.test(a) && isSecretName(a.replace(/^-+/, ''))) {
        out.push(a);
        redactNext = true;
      } else {
        out.push(freeText(a));
      }
    }
    return out;
  };

  return {
    enabled,
    text,
    freeText,
    leaf: (p, v) => {
      if (!enabled) return v;
      if (p.startsWith('header:') && SECRET_HEADERS.has(p.slice(7))) return REDACTED;
      if (p === 'body' || p === 'body:strings') return freeText(v);
      return scalar(leafKey(p), v, pathHasSecret(p));
    },
    path,
    value: (v) => value(v),
    url,
    argv,
    id,
  };
}

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g;

/** Replace control characters (terminal escapes included) with visible `\xNN` text. */
export function sanitize(s: string): string {
  return s.replace(CONTROL, (c) => `\\x${c.charCodeAt(0).toString(16).padStart(2, '0')}`);
}

/** Sanitize every string in a JSON-like structure (returns a copy). */
export function sanitizeDeep<T>(v: T): T {
  if (typeof v === 'string') return sanitize(v) as T;
  if (Array.isArray(v)) return v.map((x: unknown) => sanitizeDeep(x)) as T;
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, child] of Object.entries(v as Record<string, unknown>)) out[sanitize(k)] = sanitizeDeep(child);
    return out as T;
  }
  return v;
}
