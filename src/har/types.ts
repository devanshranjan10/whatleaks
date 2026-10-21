/**
 * HAR 1.2 (http://www.softwareishard.com/blog/har-12-spec/) plus whatleaks extensions.
 * The spec allows custom fields when they start with an underscore, so everything
 * whatleaks-specific lives under `_whatleaks`.
 */

export interface HarNameValue {
  name: string;
  value: string;
}

export interface HarPostParam {
  name: string;
  value?: string;
  fileName?: string;
  contentType?: string;
}

export interface HarPostData {
  mimeType: string;
  text?: string;
  params?: HarPostParam[];
  /** whatleaks extension: `base64` when `text` holds binary bytes. */
  _encoding?: 'base64';
  /** Some tools put the encoding here, mirroring `content.encoding`. */
  encoding?: string;
}

export interface HarRequest {
  method: string;
  url: string;
  httpVersion: string;
  cookies: HarNameValue[];
  headers: HarNameValue[];
  queryString: HarNameValue[];
  postData?: HarPostData;
  headersSize: number;
  bodySize: number;
}

export interface HarContent {
  size: number;
  mimeType: string;
  text?: string;
  encoding?: string;
}

export interface HarResponse {
  status: number;
  statusText: string;
  httpVersion: string;
  cookies: HarNameValue[];
  headers: HarNameValue[];
  content: HarContent;
  redirectURL: string;
  headersSize: number;
  bodySize: number;
}

export interface HarTimings {
  send: number;
  wait: number;
  receive: number;
}

export interface EntryMeta {
  id?: string;
  /** Request body bytes as they crossed the wire (before content-decoding). */
  wireBodySize?: number;
  /** The content-encoding that whatleaks removed before storing `postData.text`. */
  decoded?: string;
  /** The stored request body was cut at the size cap. */
  truncated?: boolean;
  /** The request never completed: the client or upstream aborted it. */
  aborted?: string;
  /** Still in flight when the capture stopped. */
  incomplete?: boolean;
  websocket?: { sent: number; samples: string[] };
}

export interface HarEntry {
  startedDateTime: string;
  time: number;
  request: HarRequest;
  response: HarResponse;
  cache: Record<string, never>;
  timings: HarTimings;
  _whatleaks?: EntryMeta;
}

/** A host whose TLS handshake failed against the run's CA, so its traffic could not be read. */
export interface RefusedHost {
  host: string;
  count: number;
  cause: string;
  firstAt: string;
  lastAt: string;
}

/** A host the user asked not to decrypt (`--passthrough`). */
export interface PassthroughHost {
  host: string;
  port: number;
  count: number;
  firstAt: string;
  lastAt: string;
}

/** A connection from a tracked process that did not go through the proxy. */
export interface DirectConn {
  remote: string;
  port: number;
  protocol: 'TCP' | 'UDP';
  process: string;
  firstAt: string;
  lastAt: string;
  /** Number of watcher samples that saw this connection. */
  samples: number;
  rdns?: string;
}

export interface SessionMeta {
  schema: 'whatleaks/capture@1';
  label: string;
  command: string[];
  cwd: string;
  startedAt: string;
  endedAt: string;
  exitCode: number | null;
  signal: string | null;
  stoppedBy: 'exit' | 'duration' | 'interrupt';
  platform: string;
  arch: string;
  node: string;
  whatleaks: string;
  /** Names (never values of user secrets) of the opt-out variables applied to this run. */
  optOutEnv: string[];
  refused: RefusedHost[];
  passthrough: PassthroughHost[];
  direct: DirectConn[];
  watcher: 'on' | 'off' | 'unavailable';
  notes: string[];
}

export interface Har {
  log: {
    version: string;
    creator: { name: string; version: string };
    pages?: unknown[];
    entries: HarEntry[];
    _whatleaks?: SessionMeta;
  };
}

/** One request, normalised from any HAR producer. */
export interface CapturedRequest {
  index: number;
  /** Epoch milliseconds. */
  startedAt: number;
  /** Milliseconds since the capture started. */
  offsetMs: number;
  method: string;
  url: string;
  host: string;
  port: number | null;
  scheme: string;
  path: string;
  headers: HarNameValue[];
  /** Request body bytes, already content-decoded where the producer did so. */
  body: Uint8Array;
  /** Bytes on the wire if known, else the stored body length. */
  wireBodySize: number;
  mimeType: string;
  status: number;
  responseHeaders: HarNameValue[];
  responseText?: string;
  responseSize: number;
  truncated: boolean;
  aborted?: string;
  incomplete: boolean;
  websocket?: { sent: number; samples: string[] };
}

export interface Capture {
  source: 'whatleaks' | 'har';
  creator: { name: string; version: string };
  startedAt: number;
  endedAt: number;
  meta?: SessionMeta;
  requests: CapturedRequest[];
  /** Entries that were skipped or partly read, in plain words. */
  warnings: string[];
}
