import { createHash, createHmac, randomBytes } from 'node:crypto';
import type { IdentityKind } from '../model.js';

export interface Identity {
  kind: IdentityKind;
  value: string;
}

export const IDENTITY_TITLES: Record<IdentityKind, string> = {
  username: 'Your OS username',
  hostname: "Your computer's hostname",
  home: 'Your home directory path',
  'project-path': "The project's folder path",
  mac: 'A MAC address of this machine',
  'machine-id': "This machine's hardware/OS ID",
  'git-email': 'Your git email address',
  'git-name': 'Your git user name',
};

export interface Matcher {
  kind: IdentityKind;
  /** `raw`, `lowercase`, `no-separators`, `md5`, `sha1`, `sha256`, `base64`, `json-escaped`. */
  form: string;
  /** The text to find: lowercased unless `caseSensitive`. */
  needle: string;
  /** File paths and base64 differ by case; hex hashes, names and hosts do not. */
  caseSensitive: boolean;
  /** Required character class that must NOT touch the match on either side. */
  boundary: RegExp | null;
}

/** Common account and host names that would match everywhere and identify nobody. */
const GENERIC_NAMES = new Set([
  'root', 'admin', 'administrator', 'user', 'guest', 'runner', 'ubuntu', 'vagrant', 'ec2-user', 'test',
  'home', 'localhost', 'node', 'default', 'docker', 'build', 'debian', 'centos', 'fedora', 'pi',
]);

const ALNUM = /[A-Za-z0-9]/;
const HEXCH = /[0-9A-Fa-f]/;

const hash = (algo: string, s: string): string => createHash(algo).update(s, 'utf8').digest('hex');

/** Scanning order matters: longer, more specific identifiers are blanked out first. */
const ORDER: IdentityKind[] = ['project-path', 'home', 'git-email', 'machine-id', 'mac', 'hostname', 'git-name', 'username'];

function usable(id: Identity): boolean {
  const v = id.value.trim();
  if (v.length < 4) return false;
  if ((id.kind === 'username' || id.kind === 'hostname' || id.kind === 'git-name') && GENERIC_NAMES.has(v.toLowerCase())) {
    return false;
  }
  if ((id.kind === 'home' || id.kind === 'project-path') && v.split(/[\\/]/).filter(Boolean).length < 2) return false;
  if (id.kind === 'mac' && /^(00[:-]?){5}00$/.test(v)) return false;
  return true;
}

/** Expand identities into every form we look for: raw, separator variants, hashes, base64. */
export function buildMatchers(identities: Identity[]): Matcher[] {
  const seen = new Set<string>();
  const out: Matcher[] = [];
  const add = (kind: IdentityKind, form: string, needle: string, boundary: RegExp | null): void => {
    const caseSensitive = form === 'base64' || ((kind === 'home' || kind === 'project-path') && !/^(md5|sha1|sha256)$/.test(form));
    const n = caseSensitive ? needle : needle.toLowerCase();
    const key = `${kind}\0${n}`;
    if (n.length < 4 || seen.has(key)) return;
    seen.add(key);
    out.push({ kind, form, needle: n, boundary, caseSensitive });
  };

  const sorted = identities.filter(usable).sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));
  for (const { kind, value } of sorted) {
    const v = value.trim();
    const hashSources = new Set([v, v.toLowerCase()]);
    if (kind === 'mac') {
      const parts = v.toLowerCase().split(/[:-]/);
      const colon = parts.join(':');
      add(kind, 'raw', colon, HEXCH);
      add(kind, 'raw', parts.join('-'), HEXCH);
      add(kind, 'no-separators', parts.join(''), HEXCH);
      for (const s of [colon, colon.toUpperCase(), parts.join(''), parts.join('-')]) hashSources.add(s);
    } else if (kind === 'home' || kind === 'project-path') {
      add(kind, 'raw', v, null);
      add(kind, 'json-escaped', v.replaceAll('/', '\\/'), null);
      add(kind, 'url-encoded', encodeURIComponent(v), null);
    } else if (kind === 'machine-id') {
      add(kind, 'raw', v, ALNUM);
      add(kind, 'no-separators', v.replaceAll('-', ''), HEXCH);
    } else {
      add(kind, 'raw', v, kind === 'git-email' ? null : ALNUM);
      if (v.length >= 6) {
        add(kind, 'base64', Buffer.from(v).toString('base64').replace(/=+$/, ''), null);
      }
    }
    for (const src of hashSources) {
      add(kind, 'md5', hash('md5', src), HEXCH);
      add(kind, 'sha1', hash('sha1', src), HEXCH);
      add(kind, 'sha256', hash('sha256', src), HEXCH);
    }
  }
  return out;
}

export interface IdentityHit {
  kind: IdentityKind;
  form: string;
}

export interface ScanResult {
  hits: IdentityHit[];
  /** The input with matches blanked, for the generic detectors to run on. */
  rest: string;
}

function bounded(text: string, start: number, end: number, boundary: RegExp | null): boolean {
  if (!boundary) return true;
  const before = start > 0 ? text[start - 1]! : '';
  const after = end < text.length ? text[end]! : '';
  return !(before && boundary.test(before)) && !(after && boundary.test(after));
}

/**
 * Find local identifiers in a string. Matches are blanked as they are found so a username
 * inside a matched home path is reported once, as the home path.
 */
export function scanIdentity(text: string, matchers: Matcher[]): ScanResult {
  const hits: IdentityHit[] = [];
  let work = text;
  let lower = text.toLowerCase();
  for (const m of matchers) {
    let from = 0;
    let found = false;
    for (;;) {
      const at = (m.caseSensitive ? work : lower).indexOf(m.needle, from);
      if (at === -1) break;
      const end = at + m.needle.length;
      if (bounded(work, at, end, m.boundary)) {
        found = true;
        const blank = '\u0000'.repeat(m.needle.length);
        work = work.slice(0, at) + blank + work.slice(end);
        lower = lower.slice(0, at) + blank + lower.slice(end);
      }
      from = end;
    }
    if (found) hits.push({ kind: m.kind, form: m.form });
  }
  return { hits, rest: work };
}

/**
 * Starts only where a run of local-part characters starts, with RFC length caps. The
 * unanchored `[…]+@` form retried from every position of a long run without an '@',
 * which made a 1 MiB upload of plain text take hours to report.
 */
const EMAIL_RE = /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,253}\.[A-Za-z]{2,63}/g;
const PATH_RE = /(?:\/(?:Users|home|root|Volumes|private|var\/folders|tmp|mnt)\/[^\s"'<>|:*?]+|[A-Za-z]:\\(?:Users|Documents and Settings)\\[^\s"'<>|:*?]+)/g;

export function findEmails(text: string): string[] {
  return text.match(EMAIL_RE) ?? [];
}

export function findPaths(text: string): string[] {
  return text.match(PATH_RE) ?? [];
}

/** Random per process, so fingerprints cannot be brute-forced or matched across reports. */
const FINGERPRINT_KEY = randomBytes(32);

/** Compares ids between reports built in the same process (diff, compare) without revealing them. */
export function fingerprint(value: string): string {
  return createHmac('sha256', FINGERPRINT_KEY).update(value, 'utf8').digest('hex').slice(0, 16);
}
