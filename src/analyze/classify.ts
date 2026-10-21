import { HOST_RULES, type HostRule } from '../catalog/hosts.js';
import type { Category, Classification } from '../model.js';

/** `x.com` matches `x.com` and any subdomain of it. */
export function hostMatches(host: string, pattern: string): boolean {
  const h = host.toLowerCase();
  const p = pattern.toLowerCase();
  return h === p || h.endsWith(`.${p}`);
}

function catalogMatch(host: string, rules: readonly HostRule[]): HostRule | undefined {
  let best: HostRule | undefined;
  for (const rule of rules) {
    if (hostMatches(host, rule.host) && (!best || rule.host.length > best.host.length)) best = rule;
  }
  return best;
}

interface Heuristic {
  category: Category;
  path?: RegExp;
  host?: RegExp;
}

/** Most specific first. Patterns match whole path segments or host labels. */
const HEURISTICS: Heuristic[] = [
  {
    category: 'errors',
    path: /\/(envelope|store|crash(es|report|reports)?|minidump|errors?|exceptions?|error-report(ing)?)(\/|$)/i,
    host: /(^|[.-])(sentry|crash(es|reports?)?|bugsnag|rollbar|errors?)([.-]|$)/i,
  },
  {
    category: 'flags',
    path: /\/(feature-?flags?|flags|experiments?|evalx|get_config|toggles?|decide)(\/|$)/i,
    host: /(^|[.-])(statsig|featuregates|launchdarkly|flags?|experiments?)([.-]|$)/i,
  },
  {
    category: 'analytics',
    path: /\/(telemetry|track|collect|events?|analytics|batch|beacon|ingest|logs?|metrics|traces|capture|record|rum|stats|usage|ping|monitor|e)(\/|$)/i,
    host: /(^|[.-])(telemetry|analytics|metrics|stats|events?|tracking|collect(or)?|beacon|ingest|logs?|rum|monitor(ing)?)([.-]|$)/i,
  },
  {
    category: 'updates',
    path: /\/(updates?|latest|releases?|version|versions|check-?update|checkpoint)(\/|$)/i,
    host: /(^|[.-])(updates?|update-server|releases?|checkpoint(-api)?)([.-]|$)/i,
  },
];

function heuristicMatch(host: string, path: string): Classification | undefined {
  for (const h of HEURISTICS) {
    const pm = h.path?.exec(path);
    if (pm) return { category: h.category, basis: 'heuristic', reason: `path segment "/${pm[1]}"` };
    const hm = h.host?.exec(host);
    if (hm) return { category: h.category, basis: 'heuristic', reason: `host label "${hm[2]}"` };
  }
  return undefined;
}

/**
 * Classify an endpoint. A catalog host (with a documented source) beats a keyword
 * heuristic, and the basis is always recorded so a guess never reads as a fact.
 */
export function classify(host: string, path: string, rules: readonly HostRule[] = HOST_RULES): Classification {
  const rule = catalogMatch(host, rules);
  if (rule) {
    return { category: rule.category, basis: 'catalog', reason: `${rule.vendor} (${rule.host})`, vendor: rule.vendor };
  }
  return heuristicMatch(host, path) ?? { category: 'other', basis: 'none', reason: 'no catalog entry or keyword match' };
}

const SEVERITY: Record<Category, number> = { errors: 4, analytics: 5, flags: 3, updates: 2, other: 1 };

/** Order categories for display: telemetry-ish first. */
export function categoryRank(c: Category): number {
  return SEVERITY[c];
}
