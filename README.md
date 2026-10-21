# whatleaks

**See what an app you run sends home, and what it still sends after you opt out.**

whatleaks runs a command through a local, single-run proxy and tells you:
- where the app's traffic went
- how often
- which fields each payload carried, with redacted samples
- whether any of it is about you: your username, hostname, home path, MAC address
  (also as a hash), machine id, git email

`whatleaks compare` runs the command twice, first with defaults and then opted out of
telemetry, and shows what is *still* sent.

```
$ whatleaks compare --no-known-opt-outs --off-env DO_NOT_TRACK=1 -- ./node_modules/.bin/next build
…
The telemetry endpoint was still contacted after opting out.
Telemetry requests: 8 → 8 · all requests: 9 → 9

STILL SENDING AFTER OPT-OUT
  ● POST telemetry.nextjs.org/api/v1/record  analytics · Next.js telemetry  8 → 8 requests
      still sent: context.anonymousId, context.projectId, context.sessionId, events[].eventName, meta.agentName, meta.ciName, meta.cpuCount, meta.cpuModel, meta.cpuSpeed, meta.isCI …+81

OTHER TRAFFIC
  (not identified as telemetry; check it yourself)
  = POST registry.npmjs.org/-/npm/v1/security/advisories/bulk  other  1 → 1

STILL SENT ABOUT YOU
  ○ Repeated identifiers — 8 requests, in context.anonymousId, context.projectId, context.sessionId

PERSISTENT IDENTIFIERS
  same value in both runs, so it is stored on disk and survives a restart
  ○ e4a7…4360 at context.anonymousId → POST telemetry.nextjs.org/api/v1/record
  ○ 1597…f2ed at context.projectId → POST telemetry.nextjs.org/api/v1/record
```

That is real output from Next.js 16.4.2 on 2026-10-21. `DO_NOT_TRACK=1` does not stop
Next.js telemetry. Next.js never says it does: its documented switch is
`NEXT_TELEMETRY_DISABLED=1`, and with that set whatleaks saw telemetry go from 8
requests to 0. The run log is in [`docs/e2e/`](docs/e2e/README.md).

The idea comes from hand-made telemetry investigations, like the
[Trae IDE writeup](https://news.ycombinator.com/item?id=44703164) (954 points on Hacker
News). The top comment there questioned the method: was the app restarted after
telemetry was turned off? `compare` answers that by construction. It runs the same
command twice, in fresh processes, and keeps both captures.

## Install

whatleaks is **not on npm yet**. To use it from source (Node ≥ 22.12):

```
git clone <this repo> whatleaks && cd whatleaks
npm ci && npm run build
node dist/cli.js --help
```

Or pack it and install the tarball into a project:

```
npm pack                                   # creates whatleaks-0.1.0.tgz
cd /some/project && npm install /path/to/whatleaks-0.1.0.tgz
npx whatleaks --help
```

Both routes were tested on macOS 26.6.2. The tarball install pulls 195 packages (about
41 MB), mostly the proxy library, [mockttp](https://github.com/httptoolkit/mockttp).

## Usage

```
whatleaks run [options] -- <command> [args...]       capture one run and print a report
whatleaks compare [options] -- <command> [args...]   run twice (defaults, then opted out) and diff
whatleaks report <file.har>                          analyse a HAR from whatleaks or any other tool
whatleaks diff <before.har> <after.har>              diff two captures
whatleaks opt-outs                                   list the opt-out variables `compare` sets
```

Examples:

```
# What does my build send?
whatleaks run -- npm run build

# Does the documented opt-out work? Every known opt-out variable (32) is set in the second run.
whatleaks compare -- ./node_modules/.bin/next build

# Test one specific switch, and fail CI if telemetry is still sent.
whatleaks compare --no-known-opt-outs --off-env DO_NOT_TRACK=1 --strict -- ./node_modules/.bin/turbo run build

# Long-running or interactive apps: stop after 60 seconds.
whatleaks run --duration 60 -- some-dev-server

# Tools whose opt-out is a setting, not an environment variable: two runs plus a diff.
whatleaks run --label on  -- my-tool
# (turn telemetry off in the tool's settings)
whatleaks run --label off -- my-tool
whatleaks diff whatleaks-on-*.har whatleaks-off-*.har

# Already have a HAR capture from another tool?
whatleaks report capture.har --md report.md
```

Useful options:

| Option | What it does |
|---|---|
| `--md <file>`, `--json <file>` | Write the report (or, for `compare` and `diff`, the diff) as Markdown or JSON. The Markdown has every field and full payload samples. |
| `--samples <n>` | Payload samples per endpoint (default 2). |
| `--duration <s>` | Stop the app after this many seconds. whatleaks stops every process the app started. |
| `--linger <s>` | After the app exits, wait for processes it left running (default 10 s). Some tools send telemetry from a detached helper after they exit. |
| `--passthrough <host>` | Tunnel a host without decrypting it, e.g. `*.mybank.com`. It is still counted. |
| `-e KEY=VALUE` | Extra environment variable for the app. |
| `--strict` | `compare` and `diff`: exit 1 if any telemetry endpoint is still contacted in the second run. |
| `--raw` | Turn off redaction (see below). |
| `--no-watch` | Do not sample for connections that bypass the proxy. |

Every run saves its capture as a HAR file
(`whatleaks-<label>-<time>.har`). The file is readable only by you and is never
redacted.

## Example report

The first part of `whatleaks report` on the Next.js capture, unedited apart from the
cut at the end:

```
whatleaks · ./node_modules/.bin/next build · 3.7 s · exit 0
9 requests to 2 destinations · ≈10.6 KB sent · 8 to telemetry endpoints
activity |  █ ▃   █ ▃▃        | over 3.7 s

WHAT IT SENT ABOUT YOU
  ○ Repeated identifiers: 3 ids reused across requests (e4a7…4360 ×8, 1597…f2ed ×8, a752…40db ×8)
      in context.anonymousId, context.projectId, context.sessionId

WHERE IT WENT
  DESTINATION           CATEGORY                       REQUESTS      SENT
  telemetry.nextjs.org  analytics · Next.js telemetry         8  ≈10.3 KB
  registry.npmjs.org    other                                 1    ≈321 B

ENDPOINTS
  POST telemetry.nextjs.org/api/v1/record  analytics · Next.js telemetry
      8 requests · first +0.5s · every ~223 ms · ≈10.3 KB · status 204×8
      fields: context.anonymousId (id, same in every request), context.projectId (id, same in every request), context.sessionId (id, same in every request), events[].eventName, meta.agentName, meta.ciName, meta.cpuCount, meta.cpuModel …+83
      sample (+0.5s):
        {
          "context": {
            "anonymousId": "e4a7…4360",
            "projectId": "1597…f2ed",
            "sessionId": "a752…40db"
          },
…
```

The full report is in [`docs/e2e/next-build-report.txt`](docs/e2e/next-build-report.txt)
and, as Markdown with all 91 fields and two payload samples,
[`docs/e2e/next-build-report.md`](docs/e2e/next-build-report.md).

When a payload carries something about you, the report says what, how it was encoded
and where it appeared. This line is from the test suite's synthetic capture:

```
  ● A MAC address of this machine as sha256 — 3 requests to api.segment.io
      in batch[].context.device.id
```

## How it works

1. **Single-run CA.** Each run generates a fresh certificate authority. Its private key
   stays in memory. Its certificate is written to a private temp folder that is
   deleted when the run ends.
2. **Loopback proxy.** The proxy is built on mockttp and listens on `127.0.0.1` only.
   mockttp would listen on every interface by default; whatleaks forces loopback, and
   a test checks it.
3. **Standard environment variables.** whatleaks points the app at the proxy and tells
   it to trust the run's CA:
   - proxy: `HTTP(S)_PROXY` in both cases, `NODE_USE_ENV_PROXY=1`
   - CA: `NODE_EXTRA_CA_CERTS`, `SSL_CERT_FILE`, `REQUESTS_CA_BUNDLE`,
     `CURL_CA_BUNDLE`, `GIT_SSL_CAINFO`, `DENO_CERT`

   Trust reaches only the app's own process tree. **Nothing is installed in your
   system's trust store, and no system proxy settings change.**
4. **Process tree.** whatleaks follows every process the app starts, including
   detached helpers, so it can wait for late telemetry and stop everything on
   `--duration`.
5. **Not-visible traffic.** An app that refuses the CA, such as one that pins
   certificates, fails that request. whatleaks lists the host by name, with a count,
   under "not visible". It does not try to get around pinning. Connections that ignore
   the proxy are sampled with `lsof` every 0.5 s and listed by address.
6. **Analysis.**
   - Requests are grouped into endpoints, with path ids templated
     (`/users/123` → `/users/:id`).
   - JSON, NDJSON, form and binary bodies are decoded.
   - Every field is inventoried.
   - Payloads are searched for this machine's identifiers, raw and as md5, sha1 and
     sha256 hex and base64. The local values are read into memory only and never
     written.
   - Endpoints are classified from a catalog of 69 known telemetry hosts, each with a
     source link. Otherwise a URL keyword guess is used, always marked `?`.

## Reports are redacted

Reports are meant to be shared, so by default:
- this machine's identifiers become labels (`‹home›`, `‹sha256(mac)›`, …)
- secret-looking headers, fields and query parameters become `‹redacted›`
- emails become `‹email›`
- id-shaped values are masked (`e4a7…4360`)

`--raw` turns this off.

Redaction is pattern-based, so read a report before you post it. The HAR file holds
the raw traffic: share the report, not the HAR.

## Accuracy

The full write-up is in [`docs/ACCURACY.md`](docs/ACCURACY.md). In short:

- **Next.js 16.4.2:** whatleaks captured exactly the 22 events, with the same counts
  for all 7 event names, that `NEXT_TELEMETRY_DEBUG=1` prints for the same build.
- **Turborepo 2.11.10:** whatleaks captured 10 of the 17 events that
  `TURBO_TELEMETRY_DEBUG=1` prints. The other 7 never left the process: turbo exits
  about a second after its last batch is queued, before that batch's request starts.
  whatleaks reports what crossed the wire, not what a tool intended to send.
- **Clients checked by tests or real runs:**
  - Node `fetch`, `http` and `https` (Node ≥ 22.21 or ≥ 24.5)
  - curl
  - Python `urllib` (Homebrew build)
  - a Rust binary (turbo)
  - detached helpers that send after the app exits, including `next dev` on shutdown
  - clients that refuse the CA (Go, Apple's Python, a pinned client): named, contents
    hidden
  - a direct connection that bypasses the proxy
- **Identity detection** finds every planted identifier form in tests. On five real
  captures it reported none, and `grep` agreed that none were there.
- **Classification:** all 3 distinct endpoints in the real runs were labelled
  correctly. That is a small sample. Keyword guesses will mislabel some ordinary APIs,
  which is why they are marked `?`.

## Limitations

- **Tested on macOS only.** Linux uses the same `ps` and `lsof` calls but is
  untested. Windows is untested and has neither tool, so process watching would be
  off there.
- **Imported HAR from other tools:** the reader handles browser-devtools-style and
  mitmproxy-style HAR (tested with hand-made samples of both formats). It was not
  tested with real exports from Proxyman, Charles or HTTP Toolkit.
- **Only processes you launch through whatleaks.** GUI apps, Electron apps, browsers
  and system daemons were not tested.
- **Apps that ignore proxy variables or the CA cannot be read:**
  - Go programs on macOS and Apple's `/usr/bin/python3` refuse the CA (both checked).
    They are named, not read.
  - Node older than 22.21 (or 24.0–24.4 for `http`/`https`) ignores
    `NODE_USE_ENV_PROXY`. whatleaks warns when the `node` on `PATH` is like that.
  - Their connections show up only if the 0.5 s sampler catches them. Short ones are
    missed.
- **Node 22 prints a warning.** On Node 22, the app prints an `UNDICI-EHPA`
  experimental warning when it starts. That is Node's built-in proxy support, which
  whatleaks turns on.
- **Not tested:** WebSockets, HTTP/2-only clients and HTTP/3 (QUIC).
- **`compare` runs defaults first.** Events a tool sends only on first use can make a
  "stopped" result look better than it is. A "still sending" result is always a direct
  observation. Repeat a comparison before trusting a stop.
- **Exact matching only.** Identity matching cannot see salted hashes. Redaction and
  classification are pattern-based.
- **Next.js on Node 24 and 26.** Next.js 16.4.2's telemetry fails inside the process
  on Node 24.22 and 26.0, with or without whatleaks, so you will see none there. The
  Next.js examples above used Node 22.23.3. See `docs/e2e/README.md` §3.

## Development

```
npm ci
npm run check     # typecheck, lint, tests (all offline; integration tests use local servers only)
npm run build
```

- Tests use recorded fixtures and loopback servers only.
- `test/fixtures/real/` holds scrubbed captures of real `next build` runs.
- Design notes are in [`docs/`](docs/):
  - the spec: `docs/superpowers/specs/`
  - the decision log: `DECISIONS.md`
  - research: `RESEARCH.md`
  - progress: `PROGRESS.md`

## License

MIT
