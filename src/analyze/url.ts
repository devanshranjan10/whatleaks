const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX_RE = /^[0-9a-f]{16,}$/i;
const DIGITS_RE = /^\d+$/;
const EMAIL_RE = /^[^@\s/]+@[^@\s/]+\.[a-z]{2,}$/i;
const TOKEN_RE = /^[A-Za-z0-9_\-+=.~]{24,}$/;

/** Is this path segment an identifier rather than part of the route? */
export function isIdSegment(segment: string): boolean {
  if (segment === '') return false;
  if (DIGITS_RE.test(segment) || UUID_RE.test(segment) || HEX_RE.test(segment) || EMAIL_RE.test(segment)) {
    return true;
  }
  // Long opaque tokens: must mix letters and digits so long words and slugs survive.
  return TOKEN_RE.test(segment) && /\d/.test(segment) && /[A-Za-z]/.test(segment);
}

function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** `/v1/users/123/events` → `/v1/users/:id/events`. Query strings are not part of the template. */
export function templatePath(pathname: string): string {
  const path = pathname.split('?')[0] ?? '';
  return path
    .split('/')
    .map((seg) => (isIdSegment(safeDecode(seg)) ? ':id' : seg))
    .join('/');
}

export function queryParamNames(url: string): string[] {
  try {
    return [...new Set(new URL(url).searchParams.keys())].sort();
  } catch {
    return [];
  }
}
