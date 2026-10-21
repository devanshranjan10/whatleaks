# whatleaks benchmark and gap closing: design

Date: 2026-10-21. Owner request: "run the evals and benchmarks and achieve SOTA in
whatleaks. Fix all the gaps", then "do what's best … everything should be real".
Decision record: D-24 onwards in `docs/DECISIONS.md`.

## 1. Problem

whatleaks has unit and integration tests but no benchmark. `docs/ACCURACY.md` holds
hand-run numbers for two tools. Nothing measures:
- how often a request is silently missed, per client type;
- how whatleaks compares with the tools people use today;
- what it costs (startup, latency, memory).

No public benchmark exists for "audit what a CLI sends home" (RESEARCH §2), so "SOTA"
needs a scoreboard first. This design builds one, runs it against whatleaks and two
real baselines, then fixes the gaps it exposes and re-runs it.

## 2. What "best" means here (the metrics)

Per attempted event (one request, connection or message the client tried to send):

| Outcome | Meaning |
|---|---|
| `payload` | request in the capture, body byte-identical to what the client sent |
| `request` | request in the capture, body missing or cut off |
| `host` | not decrypted, but the destination is named (refused, passthrough, direct) |
| `missed` | nothing in the output points to it |

Headline metrics:
- **Silent-miss rate** = missed / attempted. The goal is zero: whatever whatleaks
  cannot read, it must at least name. This is the property a privacy audit needs.
- **Payload recall** = payload / attempted.
- **False attributions** = destinations or requests in the output that the app did not
  send (traffic from other processes). Must be zero.
- Identity detection: recall and precision on planted identifiers and decoys.
- Cost: startup overhead, per-request latency (p50, p95), upload throughput, peak RSS.

Every number is produced by a script in `bench/`, written to `bench/results/`, and
copied into `docs/BENCHMARK.md` with the command that produced it.

## 3. Part A: lab benchmark (offline ground truth)

**Lab server** (`bench/lab/server.ts`), two listeners:
- loopback HTTP, the target the capture proxy forwards lab traffic to (the same
  `testRoutes` mechanism the integration tests use, reached through
  `runCommand`, so the real `run` code path is measured);
- LAN-address HTTPS, HTTP/2 and TCP/UDP, for clients that bypass the proxy. A lab CA
  signs its certificate; only bypass clients are given that CA.

The lab hostname is `<lan-ip-dashed>.sslip.io`, which resolves to the LAN address
through public DNS, so a client that ignores the proxy really connects to the lab, as it
would to a real vendor. The proxy never resolves it (test route).

**Ground truth:** every client appends one ledger line *before* each attempt
(`LAB_LEDGER`), and the lab logs what it received. Events carry
`/e/<scenario>/<run>/<seq>` paths and known bodies.

**Scenarios** (`bench/lab/scenarios.ts`), each repeated K times (K = 10 when timing
matters, 3 otherwise):
- *Proxy-aware clients:* Node 26 and 22.23 `fetch` and `https` (gzip), Node 22.19
  (old, ignores the proxy), curl, curl `--http2`, Homebrew Python `urllib`,
  `requests`, `httpx`, Bun, system Ruby, Apple Python, Go, Java `HttpClient`,
  WebSocket messages, a 9 MiB upload, brotli and zstd bodies, a pinned client.
- *Proxy-ignoring clients:* Node `http2`, `aiohttp`, raw TCP held for 10 ms, 100 ms,
  500 ms and 2 s, a connection the server closes first, a UDP datagram.
- *Lifecycle:* detached helpers whose parent exits at once, sending after 0.2, 1.5, 3
  and 8 s; a grandchild chain; a short-lived child process that sends directly.
- *Identity:* bodies carrying this machine's username, hostname, home path,
  sha256(MAC), git email and machine id, plus decoys (random hex, UUIDs, `root`).

**Baselines on the lab:**
- **mitmproxy** (`uvx --from mitmproxy mitmdump`, HAR export), given the *same*
  environment whatleaks builds. This is the best case for an expert's manual setup.
  It runs for a fixed 10 s after the app exits, because it has no notion of the app.
- **zyralab/phonehome** cannot be scored on the lab: it treats 10.x and 172.16.x
  addresses as local and ignores them. It is scored on Part B instead.

## 4. Part B: real-tool corpus

Real developer tools from the catalog, installed into scratch folders under `/tmp`,
never globally. For each tool:
1. default run under whatleaks; a debug log as ground truth where the tool has one
   (`NEXT_TELEMETRY_DEBUG`, `TURBO_TELEMETRY_DEBUG`, …);
2. `DO_NOT_TRACK=1` run, and the tool's documented opt-out run (`compare`);
3. baselines: the same default run under mitmproxy (manual env) and under phonehome
   (`--all --interval 1 --no-rdap --no-open`, pinned commit, no proxy).

Scored: telemetry events seen against the debug log, telemetry hosts named,
catalog classification of each observed host, whether each opt-out verdict matches
the vendor's documentation, and what each baseline could and could not tell.

This sends the tools' real telemetry from this Mac, as the M8 runs did. It is
recorded in D-24.

## 5. Part C: analysis checks

- **HAR import** from real exports of other tools: mitmproxy `hardump` and
  Chromium's HAR writer (Playwright `recordHar`). Charles, Proxyman and HTTP Toolkit
  are GUI apps with no headless export, so they stay untested and are listed as such.
- **Linux:** the lab's proxy-aware scenarios and the direct watcher in a Docker
  `node:22` container (linux/arm64).

## 6. Gap fixes (each must move a benchmark number)

Found by probes on 2026-10-21 before the benchmark existed:

| Gap | Probe | Fix |
|---|---|---|
| Short direct connections missed (Node `http2`, `aiohttp`: 0 of 1 seen) | lsof sampled every 0.5 s, tracked pids only | **macOS: `netstat -anv`** (6 ms, all sockets with pid) every 100 ms, plus a final sweep: macOS keeps the last owner's pid on `TIME_WAIT` sockets, so a connection the app already closed can still be attributed. lsof stays as the fallback (Linux). |
| Java ignores `HTTPS_PROXY` | went direct; caught only because the JVM is slow | `JAVA_TOOL_OPTIONS` with `https.proxyHost/Port`, and a truststore made with the JDK's own `keytool` (CA + the JDK's roots), only when `java` is on PATH. |
| Short-lived child processes are not attributed | ps every 250 ms | pids seen in netstat that are not yet known are checked against the tree at once, while still alive. |
| Late detached helpers | parent exits at once, helper sends after the grace period | measure first (L26–L31), then decide. |

Fixes are judged by the benchmark: before and after numbers both go in
`docs/BENCHMARK.md`. A fix that does not move a number is not kept.

## 7. Out of scope (unchanged limits)

- Getting around pinning or a client's own trust store (Go on macOS, Apple Python,
  system Ruby): these stay `host` outcomes, named with a count (D-04).
- System-wide proxy or trust changes (D-04).
- HTTP/3: a UDP flow can be named, never decrypted.
- Publishing (hard rule; needs the owner).

## 8. Layout

```
bench/
  lab/server.ts        lab server (loopback + LAN listeners), ledger + received log
  lab/clients/         one small client per runtime (node, python, go, java, ruby, sh)
  lab/scenarios.ts     scenario table
  lab/score.ts         outcome per event, per scenario, per tool (pure, unit-tested)
  run-lab.ts           runs scenarios × K under whatleaks and mitmproxy
  run-perf.ts          startup, latency, throughput, RSS
  real/tools.ts        real-tool corpus definitions
  run-real.ts          real-tool runs + baselines
  results/             JSON + Markdown outputs, dated
docs/BENCHMARK.md      the scoreboard, with commands to reproduce
```

`bench/` is not part of the published package (`files` lists `dist` only). The scorer
gets unit tests in `test/bench-score.test.ts`, so the scoreboard cannot silently drift.
