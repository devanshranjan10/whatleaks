# whatleaks: design

Status: approved (the owner pre-approved every gate; see `docs/DECISIONS.md`).
Date: 2026-10-21.

## 1. Intent

**What the owner asked for.**
- Point a command at an app you run and get a report: what it sends, where, how often,
  with payload samples.
- A diff showing what is still sent after you turn telemetry off.
- The Trae writeup, as a command.
- TypeScript, Node 22+, ESM, tsup, vitest, commander.
- One npx-installable package.
- Offline tests with recorded fixtures.
- No publishing, no remotes, no posting.
- No README claim that has not been run.

**Assumptions I made, which the owner can correct.**
- The first users are developers auditing their own tools: dev CLIs, Node and Python
  programs, language toolchains. GUI apps are possible but secondary.
- The shareable artefact is the Markdown report, plus a one-line headline people can
  screenshot.
- The scripted compare is the credibility hook. The top HN comment on the Trae post
  attacked a manual, unrestarted method; `compare` runs the same command twice in
  fresh processes.

**Success.**
- `npx whatleaks compare -- <cmd>` runs end to end on a real tool.
- It shows the tool's telemetry endpoint, payload fields and samples, and a diff after
  the documented opt-out.
- Every number in the README comes from a run that is recorded in `docs/e2e/`.

## 2. Scope and non-goals

In scope:
- The CLI commands `run`, `compare`, `report`, `diff` and `opt-outs`.
- Reading HAR from other tools: browser devtools, mitmproxy, Proxyman, Charles, HTTP
  Toolkit.

Out of scope, by design. These are safety boundaries, not missing features:
- No system-wide changes. Nothing is added to OS or browser trust stores and no system
  proxy settings change.
- Trust in the run's CA reaches **only** the launched process tree, through standard
  environment variables.
- No flags that disable certificate validation are passed to apps. An app that will
  not trust the run's CA is reported by hostname and count only. whatleaks does not
  try to get around certificate pinning.
- No watching of processes the user did not launch through whatleaks.

Out of scope for v1, as candidates for later:
- HTML report.
- A standalone `proxy` mode for GUI apps launched by hand.
- Blocking or sinkholing of requests.
- Windows process watching.

## 3. Architecture

Two halves joined by a file format. **Capture** produces a HAR 1.2 file. **Analysis**
turns any HAR into a report, and two reports into a diff. Analysis is pure and does
no I/O, so most of the product is tested offline against fixtures.

```
run / compare ──► capture/session ──► HAR file ──► analyze ──► render (terminal | md | json)
                    │  ca, proxy, launcher,              ▲            ▲
                    │  process tree, direct watcher      │            │
report <har> ───────┴────────────────────────────────────┘     diff(report A, report B)
```

### Units

| Unit | Purpose | Depends on |
|---|---|---|
| `har/types`, `har/read`, `har/write` | HAR 1.2 types plus `_whatleaks` extensions. A tolerant reader that accepts other tools' HAR, and a writer that saves files with mode 0600. | none |
| `analyze/body` | Decodes and classifies a request body: json, ndjson, form, text, binary (with printable strings extracted). Detects gzip by its magic bytes. | node:zlib |
| `analyze/url` | Turns a path into a template (`/v1/u/123/e` → `/v1/u/:id/e`). Collects query parameter names. | none |
| `analyze/fields` | Flattens JSON into field paths (`events[].context.os`) and counts presence, types, distinct values and examples. | none |
| `analyze/identity` | Matches local identifiers, and their hashes, inside URLs, headers and bodies. Also runs generic detectors: email, absolute path, stable id. | an injectable identity source |
| `analyze/classify` | Endpoint category (analytics, errors, flags, updates, other). The basis is either the catalog or a keyword heuristic, with a reason string. | `catalog/hosts` |
| `analyze/redact` | Redacts output: local identifiers become labels, secret headers, keys and query parameters become `‹redacted›`, and emails become `‹email›`. | identity |
| `analyze/report` | Turns a HAR into a `Report` model. | all of the above |
| `diff/diff` | Turns two `Report`s into a `Diff` model. | report model |
| `render/terminal`, `render/markdown`, `render/json` | Pure string renderers. | models |
| `catalog/hosts`, `catalog/optouts` | Data with source URLs: known telemetry hosts, and documented opt-out environment variables. | none |
| `capture/ca` | Ephemeral CA, generated in memory. Writes `ca.pem` and `bundle.pem` (the CA plus Node's root store) to a 0700 temp dir that is deleted afterwards. | mockttp |
| `capture/env` | Builds the child's environment. Pure. | none |
| `capture/proxy` | mockttp bound to 127.0.0.1 with passthrough. Turns events into recorder calls. | mockttp |
| `capture/recorder` | Assembles HAR entries from request, response and abort events, plus refused-TLS and passthrough lists. | none |
| `capture/proctree` | Parses `ps` output and tracks every descendant process ID ever seen, so stragglers can be found. | `ps` |
| `capture/direct` | Parses `lsof -F` output and samples connections from the tracked processes that do not go through the proxy. | `lsof` |
| `capture/launch` | Spawns with inherited stdio, forwards signals, and handles the `--duration` kill. | none |
| `capture/session` | Orchestrates one capture, then lingers until stragglers exit or the linger limit passes, then idles. | all of `capture/*` |
| `cli` | commander wiring and exit codes. | everything |

## 4. Capture design

1. **CA.** `mockttp.generateCACertificate()` creates a fresh 2048-bit CA for each
   run. The private key exists only in memory. The certificate is written to a 0700
   temp dir that is deleted at the end.
   - `bundle.pem` holds the CA plus `tls.rootCertificates`. Tools that *replace*
     their trust store with an environment variable (curl, Python, git) therefore
     still trust normal hosts if they skip the proxy.
2. **Proxy.**
   - mockttp `getLocal({ https: { key, cert, tlsPassthrough }, http2: 'fallback' })`.
   - Rules: `forAnyRequest().thenPassThrough({ simulateConnectionErrors: true })` and
     `forAnyWebSocket().thenPassThrough()`.
   - **Must listen on 127.0.0.1 only.** mockttp listens on every interface (see
     research §4). While `start()` runs, whatleaks wraps `net.Server.prototype.listen`
     so a port-only call binds to `127.0.0.1`, then restores it. A test asserts the
     proxy is unreachable on a non-loopback address.
   - If the user already has `HTTPS_PROXY` set, it becomes the upstream proxy.
3. **Child environment.** Start from the parent environment and remove `NO_PROXY`
   and `no_proxy`. Then set:
   - `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY` and their lowercase forms
   - `NODE_USE_ENV_PROXY=1`
   - `NODE_EXTRA_CA_CERTS=ca.pem`
   - `SSL_CERT_FILE`, `REQUESTS_CA_BUNDLE`, `CURL_CA_BUNDLE` and `GIT_SSL_CAINFO`,
     each set to `bundle.pem`
   - the opt-out variables when requested
   - user `--env` values last
   The final list is driven by the capture-facts research (D-12).
4. **Launch.**
   - `spawn(cmd, args, { stdio: 'inherit', env })`.
   - Ctrl-C reaches the child through the terminal's process group. A second Ctrl-C
     kills it.
   - `--duration N` sends SIGTERM after N seconds, then SIGKILL 5 seconds later.
5. **Process tree.**
   - Poll `ps -A -o pid=,ppid=,comm=` every 250 ms.
   - Every process whose parent is tracked becomes tracked, and stays tracked after it
     is re-parented.
   - This catches detached "flush telemetry after exit" helpers.
6. **Linger.** After the main child exits:
   - Keep the proxy up while any tracked process is alive, up to `--linger`
     (default 10 s).
   - Then wait until no request has been in flight for 1 s.
   - Then stop.
7. **Direct watcher.**
   - Every 500 ms, run `lsof -nP -a -p <tracked pids> -i -F pcPnT`.
   - Record connections whose remote end is neither loopback nor the proxy. Remote
     port 53 counts as DNS.
   - At the end, run a best-effort reverse DNS lookup with a 1 s timeout per address.
   - Sampling misses short-lived connections. The report says so.
8. **Recorder.**
   - Request bodies are decoded with `getDecodedBuffer()` and stored up to 1 MiB, with
     a truncation flag.
   - Response bodies are stored only when they are text-like and at most 64 KiB.
   - `tls-client-error` events add to `refused[]` (host, count, cause, first and last
     seen). `tls-passthrough-opened` events add to `passthrough[]`.
   - WebSockets record the upgrade request, the count of sent messages and the first
     3 sent messages.
9. **HAR output.**
   - Default path: `./whatleaks-<label>-<YYYYMMDD-HHMMSS>.har`, mode 0600.
   - `log._whatleaks`: schema, label, command, cwd, start and end times, exit code,
     platform, versions, the opt-out variable names applied, `refused`,
     `passthrough`, `direct`, and capture notes.

## 5. Analysis design

### Report model (`whatleaks/report@1`)

- `capture`: label, command, startedAt, durationMs, exitCode, source
  (`whatleaks` | `har`), creator.
- `totals`: requests, destinations, endpoints, bytesSent, bytesReceived,
  refusedConnections, directConnections.
- `endpoints[]`, keyed by `METHOD host pathTemplate`:
  - category, basis, reason
  - count, firstMs, lastMs, medianGapMs, perMinute (only when the duration is at
    least 60 s), bytesSent, statuses, bodyFormats
  - fields[]: path, seenIn, types, distinct, examples (≤3, redacted), constant flag
  - queryParams[], notableHeaders[] (user-agent, plus `x-*` headers that carry ids)
  - samples[]: the first N bodies, redacted, pretty-printed, cut at 4 KB
- `destinations[]`: host, requests, bytesSent, endpoints, and the most severe
  category.
- `findings[]`, each with kind, severity, label, count, endpoints and locations:
  - local identity: username, hostname, home dir, MAC, machine id, git email or
    name, matched raw or as md5/sha1/sha256 hex or base64
  - email address
  - absolute file path
  - stable id: an id-shaped value that is constant across all of its requests
- `refused[]`, `passthrough[]`, `direct[]`, `timeline` (20 buckets), `caveats[]`.

### Rules

- Path templating replaces whole segments that are any of these with `:id`:
  - all digits
  - a UUID
  - hex of 16 or more characters
  - at least 24 characters of mixed alphanumerics
  - an email
- Identity matching:
  - Usernames and hostnames match only at 4 characters or more, and only on
    alphanumeric boundaries.
  - MACs are tried with `:` separators, `-` separators and none, in lowercase and
    uppercase.
  - Hash forms are tried for every identifier.
- Classification order:
  1. A catalog host match (vendor or tool) wins.
  2. Otherwise a path or host keyword heuristic decides.
  3. Otherwise the category is `other`.
  The basis is always shown, so heuristics never pose as facts.

### Diff model (`whatleaks/diff@1`)

- Endpoints are matched across runs by key. Status is `still`, `stopped` or `new`,
  with counts and bytes before and after.
- Fields are split into still, dropped and added.
- Findings still present after the opt-out.
- **Persistent values**: id-shaped values that appear in both runs. Because the runs
  are separate processes, such a value is stored on disk and identifies the machine
  or install across restarts.
- Headline: telemetry endpoints (analytics, errors or flags) before versus still
  contacted, and requests before versus after.

## 6. CLI

```
whatleaks run [opts] -- <cmd...>       capture one run, print report, write HAR
  -l, --label <name>  -o, --out <file>  -d, --duration <s>  --linger <s>
  --opt-out  -e, --env <K=V...>  --no-decrypt <host...>  --no-watch
  --md <file>  --json <file>  --samples <n>  --raw
whatleaks compare [opts] -- <cmd...>   run twice (default, then opted out) and diff
  --off-env <K=V...>  --no-known-opt-outs  --out-dir <dir>  --strict  (+ run opts)
whatleaks report <har> [--md f] [--json f] [--samples n] [--raw]
whatleaks diff <before.har> <after.har> [--md f] [--json f] [--strict]
whatleaks opt-outs                     list what --opt-out sets, with sources
```

Exit codes:
- `run` returns the child's exit code. A deliberate `--duration` stop returns 0.
- `diff` and `compare` return 0, or 1 under `--strict` when any telemetry endpoint is
  still contacted.
- Any usage or internal error returns 2.

## 7. Error handling

- If the command is not found, exit 2 with a clear message, and write no HAR.
- If `ps` or `lsof` is missing, disable the watcher and add a caveat. The capture
  continues.
- If the proxy fails to start, exit 2.
- If the HAR is unreadable or invalid, exit 2 and name the field.
- If the child is killed by a signal, record the signal and still write the HAR and
  the report.
- Requests still incomplete at stop are kept with status 0 and `_incomplete`.

## 8. Privacy and safety of the tool itself

- The proxy listens on loopback only. The CA is ephemeral with its key held in memory,
  and trust is given only to the child.
- HAR files hold raw traffic and are written 0600. The CLI prints a reminder to share
  the report, not the HAR.
- Reports are redacted by default. `--raw` opts out of redaction.
- Local identifiers are read into memory for matching only and are never written.

## 9. Testing

- **Unit.** Every analysis unit, plus the `ps` and `lsof` parsers and the env builder.
- **Golden.** Renderer output for fixture reports and diffs.
- **Integration, offline.**
  - Local HTTP and HTTPS upstream servers. HTTPS is trusted through
    `additionalTrustedCAs` in test mode only.
  - Real child processes: Node `fetch`, Node `https`, curl and Python where available.
  - The loopback-only bind test.
  - Refused-TLS reporting.
  - The linger behaviour for a detached straggler.
- **Recorded fixtures.** HAR captures from real runs, with identifiers scrubbed, live
  under `test/fixtures/real/` for regression tests.

## 10. Accuracy plan (published in `docs/ACCURACY.md`)

1. **Synthetic ground truth.** A "chatty app" fixture sends known requests through
   several clients. Measure endpoint, field and identity-finding recall per client.
   List clients that cannot be inspected.
2. **Real ground truth.** Where a tool can print its own telemetry locally (for
   example a debug env var), compare the events it prints with the events captured.
3. **Classification.** Hand-label every endpoint from the real runs and report
   precision and recall of the analytics, errors and flags labels.
