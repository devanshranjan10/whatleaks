# Accuracy

What whatleaks gets right, what it misses, and how each claim was checked. Everything
here was run on 2026-10-21 and 22 on macOS 26.6.2 (arm64), with whatleaks on Node 26,
and the lab also on Debian in Docker. The benchmark with every number and the baselines
(mitmproxy, HTTP Toolkit) is [`BENCHMARK.md`](BENCHMARK.md).

## 1. Ground truth on real tools

| Tool | Ground truth | What whatleaks saw | Match |
|---|---|---|---|
| Next.js 16.4.2, `next build` (Node 22.23.3 and Node 20) | `NEXT_TELEMETRY_DEBUG=1` printed 22 events, 7 names | 8 requests carrying the same 22 events, with identical per-name counts | **22 / 22 events** |
| Wrangler 4.151.3, `wrangler whoami` | its debug log printed "Posting data" 3 times | 3 events | **3 / 3** |
| Turborepo 2.11.10, `turbo run build` | `TURBO_TELEMETRY_DEBUG=1` printed 17 events | 1 request carrying 10 events (turbo aborted it after upload) | **10 / 17**: the other 7 never left the process before it exited. The cause is in turbo's own exit logic; see e2e §2 |

The Turborepo gap is not a capture miss: no second request was ever started. A debug
log shows what a tool *intends* to send, and whatleaks shows what crossed the wire.
The two can differ, and the difference is itself worth knowing.

Details and outputs: [`docs/e2e/README.md`](e2e/README.md).

## 2. Which clients can be inspected

Lab percentages are "at the best possible outcome" in `docs/BENCHMARK.md` §3: exact
ground truth, 3 or 10 runs each, on macOS and on Linux unless one is named.

| Client | Result | How it was checked |
|---|---|---|
| Node `fetch`, `http`, `https` (Node ≥ 22.21 or ≥ 24.5) | captured, bodies included | lab 100 %; integration tests; Next.js e2e |
| Node `https` with an `Agent` the app creates (keep-alive, axios, got) | captured: the preload gives such agents `proxyEnv` (D-29) | lab 100 % on Node 22.23 and 26 (mitmproxy 0 %); integration test with class and old-style subclasses |
| Node < 22.21, or 24.0–24.4 for `http`/`https` | captured through the preload's CONNECT tunnels (D-25) | lab 100 % on Node 20 (mitmproxy 0 %); Next.js on Node 20, 22 of 22 events |
| Bun `fetch` | captured | lab 100 % |
| macOS `/usr/bin/curl` 8.7.1, HTTP/1.1 and `--http2` | captured | lab 100 %; integration test |
| Python `urllib` (Homebrew 3.14, Debian), `requests`, `httpx` | captured | lab 100 % |
| Apple `/usr/bin/python3` (LibreSSL), macOS system Ruby 2.6 | captured: they ignore `SSL_CERT_FILE`, so a hook adds the run's CA to their default contexts (D-31) | lab 100 % (mitmproxy 0 %); integration tests |
| Python aiohttp (ignores proxy variables unless `trust_env=True`) | captured: the Python hook makes `trust_env` default to True (D-31) | lab 100 % (mitmproxy 0 %); integration test |
| `node:http2` (reads no proxy variables on any Node) | captured: the preload tunnels it (D-32) | lab 100 % (mitmproxy and HTTP Toolkit 0 %); integration test; Linux check against example.com |
| Go 1.26 on Linux | captured (reads `SSL_CERT_FILE`) | Linux lab 100 % |
| Java 25 (macOS) and OpenJDK 17 (Linux) `HttpClient` | captured through `JAVA_TOOL_OPTIONS` and a JKS truststore (D-26) | lab 100 % (mitmproxy 0 %); integration test |
| Rust: Turborepo 2.11.10 | captured | real-tool runs, 10 of the 10 events that leave the process |
| Go 1.26 on macOS (reads only the keychain) | refuses the CA; reported by hostname, with a count | lab 100 % at that outcome |
| A client that pins its own trust store | refused and **named** with a count; contents not shown | lab 100 %; integration test |
| WebSockets | every message the app sends is kept within limits (1000 messages, 1 MiB) and scanned | lab 100 % for 2 and 20 messages, and for identifiers in message 5 of 6 |
| Detached helper that sends after the app exits | captured up to `--linger` (default 10 s) when it runs in the app's folder or connects to the proxy | lab 100 % for 0.2, 1.5, 3 and 8 s after exit |
| Short-lived child that connects directly | named, attributed to the app | lab 100 % |
| Upload over 8 MiB, or abandoned mid-way | listed, marked cut off; the first MiB kept and decoded | lab 100 % at that outcome; integration tests |
| Node, Python or Ruby program that ignores proxy settings (raw TCP, UDP, other HTTP clients) | named as a direct connection by address, process and the hostname asked for: the runtime hook reports each socket as it opens (D-34) | lab 100 % on both platforms for TCP held 10 ms to 2 s, reset after 10 to 200 ms, closed at once by the server, and UDP connected or sent with `sendto()`; unit tests for Node, Python (Homebrew and Apple's) and Ruby 2.6 |
| Other programs (Go, Rust, C) that ignore proxy settings | named by the polling watcher, by address and process | lab, Go: server closes at once 90–100 %; reset after 10 ms 10–30 % on macOS, 20 % on Linux |
| UDP sent with `sendto()` from a program with no hook | **never seen**: the socket has no destination address | lab, Go: 0 % |
| HTTP/3 (QUIC) | not proxied; named as a direct UDP connection (QUIC uses connected sockets) | lab: connected UDP 100 % from Node; 70–100 % by polling alone in earlier runs |
| Linux | `/proc` backend, no tools needed | full lab in Docker (3.2 % silently missed, all in the Go rows); `node:22-slim` container, 6 of 6 checks |
| GUI and Electron apps, browsers, system daemons | **not tested.** whatleaks only sees processes it launches | n/a |

## 3. Identity detection

**Synthetic tests** (`test/identity.test.ts`, `test/report.test.ts`):
- Every identifier kind is found: username, hostname, home path, project path, MAC,
  machine id, git email and git name.
- So are these forms: raw, case-folded, MAC separator variants, md5/sha1/sha256 hex,
  base64, JSON-escaped paths, URL-encoded paths, and strings inside binary
  (protobuf-like) bodies.

**Lab** (`docs/BENCHMARK.md`): a request carrying this machine's username, hostname,
project path, home path, sha256(MAC), machine id, git email and git name is flagged for
all 8 kinds in every run. A WebSocket message carrying three of them is flagged too.
Decoys in the same body were not flagged: a random UUID, a random sha256, `root` and
`admin`.

**Real captures:** Astro 7.4's telemetry event was flagged for the project path. Without
a git remote, Astro sends the sha256 of the project folder as
`context.anonymousProjectId`, and whatleaks names that field and the hash form. None of the three Next.js or two Turborepo captures contained this
machine's identifiers. A plain `grep` of the raw HARs for the username, hostname, home
path and git email agreed, so there were no false positives on real data.

**Limits:**
- Matching is exact. Salted or keyed hashes cannot be recognised. Next.js salts its
  `projectId`, for example.
- whatleaks only looks for identifiers of *this* machine. On an imported HAR from
  another machine, those values will not match.
- Generic names (`root`, `admin`, `user`, …) and values shorter than 4 characters are
  skipped to avoid noise.

## 4. Classification

- **On real captures**, 3 distinct endpoints were seen and all 3 were classified
  correctly:
  - `telemetry.nextjs.org` and `telemetry.vercel.com`: catalog, analytics
  - the npm advisory check: other, not telemetry
- That is a small sample.
- The keyword heuristics (e.g. `/telemetry`, `/events`, `/batch`, `/track`) are tested
  only on synthetic URLs, and **will** mislabel some ordinary APIs. The independent
  review found GitHub `/repos/o/r/events` and Stripe `/v1/events` guessed as
  analytics. So:
  - every heuristic label is marked `?`
  - headline counts and `--strict` use **catalog hosts only**
  - guesses are listed separately as "possibly telemetry"

## 5. Redaction

- The report redacts these by default:
  - local identifiers (labels)
  - secret-named headers, fields and query params, including everything nested under
    a secret-named key
  - secrets written as `key=value`, `"key":"value"`, multipart fields or header lines
    inside free text
  - secret flags in the command line
  - emails
  - id-shaped values, which become per-report aliases (`‹id-1›`)
  - control characters, which are neutralised
- `test/leaks.test.ts` plants every leak the independent review found:
  - WebSocket tokens, multipart passwords and JSON cut at the size cap
  - secrets in the command line
  - identifiers in hosts and paths, and encoded emails in URLs
  - nested secrets and numeric secrets
  - id-shaped JSON keys and terminal escapes
  None of them appears in terminal, Markdown, JSON or diff output.
- Fingerprints used to compare ids across two runs are a keyed hash (HMAC) with a
  random key per process, so they cannot be reversed or matched against other reports.
- Redaction is pattern-based, so it is **not a guarantee**. A secret in free text under
  an innocent name will not be caught. Read a report before posting it.
- The HAR file is never redacted; share the report, not the HAR.

## 6. Biases in `compare`

- **Run order.** The default run goes first, so events a tool sends only on first use
  land in run 1. That can make a "stopped" result look better than it is. "Still
  sending" is always a direct observation from run 2, so this bias can hide leaks but
  never invent them. Repeat a comparison before trusting a stop. The Next.js and
  Turborepo comparisons were each repeated once, with the same result.
- **Different run lengths.** Request counts are then not comparable. The diff warns
  when one run is more than twice as long as the other.
- **Interactive apps.** You have to do the same thing in both runs.

## 7. What whatleaks changes in the app it watches

- Each request makes an extra loopback hop and a second TLS handshake, which adds
  latency.
- Responses pass through unchanged. whatleaks verifies the upstream certificate, so it
  never weakens TLS for the app. Checked against `self-signed.badssl.com`: Node alone
  fails with `DEPTH_ZERO_SELF_SIGNED_CERT`; through whatleaks the app gets
  `ECONNRESET`. It still fails, but with a different error.
- A client that refuses the CA fails its request. That is the cost of seeing which
  hosts pin.
- Turborepo's telemetry request was aborted by turbo itself after upload. Whether that
  also happens without a proxy was not measured.
