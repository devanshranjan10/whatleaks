# Accuracy

What whatleaks gets right, what it misses, and how each claim was checked. Everything
here was run on 2026-10-21 on macOS 26.6.2 (arm64), with whatleaks on Node 26.0.0.

## 1. Ground truth on real tools

| Tool | Ground truth | What whatleaks saw | Match |
|---|---|---|---|
| Next.js 16.4.2, `next build` (Node 22.23.3) | `NEXT_TELEMETRY_DEBUG=1` printed 22 events, 7 names | 8 requests carrying the same 22 events, with identical per-name counts | **22 / 22 events** |
| Turborepo 2.11.10, `turbo run build` | `TURBO_TELEMETRY_DEBUG=1` printed 17 events | 1 request carrying 10 events (turbo aborted it after upload) | **10 / 17**: the other 7 never left the process before it exited. The cause is in turbo's own exit logic; see e2e §2 |

The Turborepo gap is not a capture miss: no second request was ever started. A debug
log shows what a tool *intends* to send, and whatleaks shows what crossed the wire.
The two can differ, and the difference is itself worth knowing.

Details and outputs: [`docs/e2e/README.md`](e2e/README.md).

## 2. Which clients can be inspected

| Client | Result | How it was checked |
|---|---|---|
| Node `fetch`, `http`, `https` (Node ≥ 22.21 or ≥ 24.5) | captured, bodies included | integration tests (`test/integration/capture.test.ts`); Next.js e2e |
| Node < 22.21, or 24.0–24.4 for `http`/`https` | **bypasses the proxy**; whatleaks prints a warning | version table from nodejs.org docs; warning covered by `test/nodecheck.test.ts` |
| macOS `/usr/bin/curl` 8.7.1 | captured, http and https | integration test |
| Python `urllib` (Homebrew 3.14, OpenSSL) | captured | integration test |
| Apple `/usr/bin/python3` (LibreSSL 2.8.3) | ignores `SSL_CERT_FILE`, so it refuses the CA and is reported by hostname only | research agent's run with the same proxy library; not re-run through whatleaks |
| Rust: Turborepo 2.11.10 | captured | e2e |
| Go on macOS | ignores `SSL_CERT_FILE` (platform verifier), so it is reported by hostname only | research agent's run with the same proxy library; not re-run through whatleaks |
| A client that pins its own trust store | refused and **named** with a count; contents not shown | integration test |
| Detached helper that sends after the app exits | captured (whatleaks waits up to `--linger`, default 10 s) | integration test: grandchild sends 1.5 s after its parent exits |
| Program that ignores proxy settings | destination listed under "not visible" if the 0.5 s `lsof` sampler sees the connection | integration test with a connection held for 1.8 s. **Connections shorter than the sampling gap can be missed; the miss rate is not measured.** |
| Request whose body upload is cut off | listed, marked as cut off | unit test, plus the Turborepo e2e run |
| WebSockets | messages the app sends are recorded (count and first 3) | **not tested** |
| HTTP/2-only clients | configured (mockttp `http2: 'fallback'`) | **not tested** |
| HTTP/3 (QUIC, UDP) | not proxied. Appears only as a direct UDP connection, if sampled | **not tested** |
| GUI and Electron apps, browsers, system daemons | **not tested.** whatleaks only sees processes it launches, through environment variables | n/a |

## 3. Identity detection

**Synthetic tests** (`test/identity.test.ts`, `test/report.test.ts`):
- Every identifier kind is found: username, hostname, home path, project path, MAC,
  machine id, git email and git name.
- So are these forms: raw, case-folded, MAC separator variants, md5/sha1/sha256 hex,
  base64, JSON-escaped paths, URL-encoded paths, and strings inside binary
  (protobuf-like) bodies.

**Real captures:** none of the three Next.js or two Turborepo captures contained this
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
  only on synthetic URLs, and **will** mislabel some ordinary APIs. Reports therefore
  mark every heuristic label with `?` and never present a heuristic as a fact.

## 5. Redaction

- The report redacts these by default:
  - local identifiers
  - secret-named headers, fields and query params
  - emails
  - id-shaped values
- Unit tests check that none of the planted values appear in terminal, Markdown or JSON
  output.
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
