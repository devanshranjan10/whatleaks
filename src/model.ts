import type { BodyFormat } from './analyze/body.js';
import type { DirectConn, PassthroughHost, RefusedHost } from './har/types.js';

export type Category = 'analytics' | 'errors' | 'flags' | 'updates' | 'other';
/** Categories that count as telemetry in headlines and `--strict`. */
export const TELEMETRY_CATEGORIES: readonly Category[] = ['analytics', 'errors', 'flags'];

export interface Classification {
  category: Category;
  basis: 'catalog' | 'heuristic' | 'none';
  /** Plain-words reason, e.g. `catalog: Sentry (sentry.io)` or `path contains "/telemetry"`. */
  reason: string;
  vendor?: string;
}

export interface FieldStat {
  /** `events[].context.os`, `?cid`, `header:x-device-id`, `body` (plain text), `body:strings` (binary). */
  path: string;
  /** Requests (to this endpoint) that contained the field. */
  seenIn: number;
  types: string[];
  /** Distinct values seen; capped at 51 (rendered as "50+"). */
  distinct: number;
  /** Up to three distinct example values, already redacted. */
  examples: string[];
  /** Same value every time, in two or more requests. */
  constant: boolean;
  /** At least one value looks like an identifier (UUID, long hex, opaque token). */
  idLike: boolean;
}

export interface Sample {
  offsetMs: number;
  url: string;
  format: BodyFormat;
  /** Pretty-printed, redacted body (or a description for binary bodies). */
  body: string;
  truncated: boolean;
}

export interface Endpoint {
  key: string;
  method: string;
  host: string;
  pathTemplate: string;
  classification: Classification;
  count: number;
  firstMs: number;
  lastMs: number;
  medianGapMs: number | null;
  perMinute: number | null;
  /** Request bodies as sent on the wire. */
  bodyBytes: number;
  /** Request line + headers + body, approximately. */
  approxBytes: number;
  statuses: Record<string, number>;
  bodyFormats: Partial<Record<BodyFormat, number>>;
  queryParams: string[];
  userAgents: string[];
  fields: FieldStat[];
  samples: Sample[];
  websocketMessages: number;
}

export interface Destination {
  host: string;
  category: Category;
  requests: number;
  approxBytes: number;
  endpoints: string[];
}

export type IdentityKind =
  | 'username'
  | 'hostname'
  | 'home'
  | 'project-path'
  | 'mac'
  | 'machine-id'
  | 'git-email'
  | 'git-name';
export type FindingKind = IdentityKind | 'email' | 'file-path' | 'stable-id';

export interface Finding {
  kind: FindingKind;
  severity: 'high' | 'medium';
  title: string;
  /** How the value appeared: `raw`, `sha256`, `md5`, `base64`, … */
  forms: string[];
  requests: number;
  endpoints: string[];
  /** Field paths or `url` / `header:<name>`; at most 8. */
  locations: string[];
}

/** An id-shaped value seen in the traffic. Compared across runs by fingerprint. */
export interface IdValue {
  /** First 12 hex chars of sha256(value). Lets two reports be compared without the value. */
  fingerprint: string;
  /** Masked for display (`6f96…64ff`), or the full value with --raw. */
  display: string;
  requests: number;
  endpoints: string[];
  locations: string[];
}

export interface Report {
  schema: 'whatleaks/report@1';
  capture: {
    label: string;
    command: string[];
    startedAt: string;
    durationMs: number;
    exitCode: number | null;
    stoppedBy: string | null;
    source: 'whatleaks' | 'har';
    creator: string;
    optOutEnv: string[];
  };
  totals: {
    requests: number;
    destinations: number;
    endpoints: number;
    approxBytes: number;
    telemetryRequests: number;
    refusedConnections: number;
    directConnections: number;
  };
  destinations: Destination[];
  endpoints: Endpoint[];
  findings: Finding[];
  /** Every id-shaped value seen (at most 500), most-repeated first. */
  ids: IdValue[];
  refused: RefusedHost[];
  passthrough: PassthroughHost[];
  direct: DirectConn[];
  /** Request counts in 20 equal time buckets across the capture. */
  timeline: number[];
  caveats: string[];
  redacted: boolean;
}
