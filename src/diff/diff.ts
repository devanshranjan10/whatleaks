import type { Category, Classification, Endpoint, Finding, FindingKind, Report } from '../model.js';
import { TELEMETRY_CATEGORIES } from '../model.js';
import { categoryRank } from '../analyze/classify.js';
import { duration } from '../render/format.js';

export type EndpointStatus = 'still' | 'stopped' | 'new';

export interface EndpointDiff {
  key: string;
  method: string;
  host: string;
  pathTemplate: string;
  classification: Classification;
  status: EndpointStatus;
  before: { count: number; approxBytes: number } | null;
  after: { count: number; approxBytes: number } | null;
  fieldsStill: string[];
  fieldsDropped: string[];
  fieldsAdded: string[];
}

export interface PersistentId {
  fingerprint: string;
  display: string;
  locations: string[];
  endpoints: string[];
}

export interface RunSummary {
  label: string;
  command: string[];
  durationMs: number;
  requests: number;
  telemetryRequests: number;
  optOutEnv: string[];
}

export interface Diff {
  schema: 'whatleaks/diff@1';
  before: RunSummary;
  after: RunSummary;
  headline: {
    telemetryEndpointsBefore: number;
    telemetryEndpointsStill: number;
    telemetryEndpointsNew: number;
    telemetryRequestsBefore: number;
    telemetryRequestsAfter: number;
  };
  endpoints: EndpointDiff[];
  /** Findings present in the second run, with the second run's counts. */
  findingsStill: Finding[];
  /** Finding kinds present before and gone after. */
  findingsStopped: FindingKind[];
  /** Id-shaped values sent in both runs: stored on disk, identify the machine or install. */
  persistentIds: PersistentId[];
  /** Hosts whose contents could not be read in the second run. */
  hiddenAfter: string[];
  caveats: string[];
  redacted: boolean;
}

export const isTelemetry = (c: Category): boolean => TELEMETRY_CATEGORIES.includes(c);

function summary(r: Report): RunSummary {
  return {
    label: r.capture.label,
    command: r.capture.command,
    durationMs: r.capture.durationMs,
    requests: r.totals.requests,
    telemetryRequests: r.totals.telemetryRequests,
    optOutEnv: r.capture.optOutEnv,
  };
}

function fieldSet(ep: Endpoint | undefined): Set<string> {
  return new Set((ep?.fields ?? []).map((f) => f.path));
}

const STATUS_ORDER: Record<EndpointStatus, number> = { still: 0, new: 1, stopped: 2 };

export function buildDiff(before: Report, after: Report): Diff {
  const b = new Map(before.endpoints.map((e) => [e.key, e]));
  const a = new Map(after.endpoints.map((e) => [e.key, e]));
  const keys = [...new Set([...b.keys(), ...a.keys()])];

  const endpoints: EndpointDiff[] = keys.map((key) => {
    const eb = b.get(key);
    const ea = a.get(key);
    const ref = (ea ?? eb)!;
    const fb = fieldSet(eb);
    const fa = fieldSet(ea);
    return {
      key,
      method: ref.method,
      host: ref.host,
      pathTemplate: ref.pathTemplate,
      classification: ref.classification,
      status: eb && ea ? 'still' : ea ? 'new' : 'stopped',
      before: eb ? { count: eb.count, approxBytes: eb.approxBytes } : null,
      after: ea ? { count: ea.count, approxBytes: ea.approxBytes } : null,
      fieldsStill: eb && ea ? [...fa].filter((f) => fb.has(f)) : [],
      fieldsDropped: eb && ea ? [...fb].filter((f) => !fa.has(f)) : [],
      fieldsAdded: eb && ea ? [...fa].filter((f) => !fb.has(f)) : [],
    };
  });
  endpoints.sort(
    (x, y) =>
      STATUS_ORDER[x.status] - STATUS_ORDER[y.status] ||
      Number(isTelemetry(y.classification.category)) - Number(isTelemetry(x.classification.category)) ||
      categoryRank(y.classification.category) - categoryRank(x.classification.category) ||
      (y.after?.count ?? y.before?.count ?? 0) - (x.after?.count ?? x.before?.count ?? 0) ||
      x.key.localeCompare(y.key),
  );

  const beforeIds = new Map(before.ids.map((i) => [i.fingerprint, i]));
  const persistentIds: PersistentId[] = after.ids
    .filter((i) => beforeIds.has(i.fingerprint))
    .map((i) => ({
      fingerprint: i.fingerprint,
      display: i.display,
      locations: [...new Set([...(beforeIds.get(i.fingerprint)?.locations ?? []), ...i.locations])],
      endpoints: [...new Set(i.endpoints)],
    }));

  const afterKinds = new Set(after.findings.map((f) => f.kind));
  const tel = (r: Report): Endpoint[] => r.endpoints.filter((e) => isTelemetry(e.classification.category));
  const headline = {
    telemetryEndpointsBefore: tel(before).length,
    telemetryEndpointsStill: endpoints.filter((e) => e.status === 'still' && isTelemetry(e.classification.category)).length,
    telemetryEndpointsNew: endpoints.filter((e) => e.status === 'new' && isTelemetry(e.classification.category)).length,
    telemetryRequestsBefore: before.totals.telemetryRequests,
    telemetryRequestsAfter: after.totals.telemetryRequests,
  };

  const caveats: string[] = [];
  if (before.totals.requests === 0) caveats.push('The first run made no requests whatleaks could see, so there was nothing to compare against.');
  else if (headline.telemetryEndpointsBefore === 0) {
    caveats.push('The first run contacted no known or guessed telemetry endpoints; check the full endpoint list before concluding nothing is sent.');
  }
  if (endpoints.some((e) => e.status === 'stopped')) {
    caveats.push(
      '"Stopped" means not seen in the second run. Some tools send certain events only on first use, or upload on a later run, so repeat the comparison before relying on a stop.',
    );
  }
  const longer = Math.max(before.capture.durationMs, after.capture.durationMs);
  const shorter = Math.min(before.capture.durationMs, after.capture.durationMs);
  if (shorter > 0 && longer / shorter > 2) {
    caveats.push(`The runs lasted ${duration(before.capture.durationMs)} and ${duration(after.capture.durationMs)}, so request counts are not like for like.`);
  }
  const hiddenAfter = [...new Set([...after.refused.map((r) => r.host), ...after.passthrough.map((p) => p.host), ...after.direct.map((d) => d.rdns ?? d.remote)])];
  if (hiddenAfter.length > 0) {
    caveats.push(`In the second run, ${hiddenAfter.length} destination${hiddenAfter.length === 1 ? '' : 's'} could not be read (see "not visible"), so the diff cannot say what they carried.`);
  }

  return {
    schema: 'whatleaks/diff@1',
    before: summary(before),
    after: summary(after),
    headline,
    endpoints,
    findingsStill: after.findings,
    findingsStopped: before.findings.map((f) => f.kind).filter((k) => !afterKinds.has(k)),
    persistentIds,
    hiddenAfter,
    caveats,
    redacted: before.redacted && after.redacted,
  };
}

/** `--strict`: any telemetry endpoint contacted in the second run. */
export function stillSendsTelemetry(diff: Diff): boolean {
  return diff.endpoints.some((e) => e.status !== 'stopped' && isTelemetry(e.classification.category));
}
