# Benchmark

What whatleaks catches, what it misses, and what it costs, measured against ground
truth and against two tools people use today:
- [mitmproxy](https://mitmproxy.org) 12.2.3, run with the same proxy and CA variables
  whatleaks sets;
- [zyralab/phonehome](https://github.com/zyralab/phonehome) at commit `946f42d`, a
  per-process connection watcher.

Everything was run on 2026-10-21 on the developer's Mac: macOS 26.6.2, Apple Silicon,
8 cores. That machine is a working desktop, not an idle bench box: load average 8 to
18 during the runs. Every number comes from a script in `bench/` and a result file in
`bench/results/`. The design is in
`docs/superpowers/specs/2026-10-21-whatleaks-bench-design.md` (D-24).

"Before" is the build at the start of this work (`8c6baa0`). "After" is `6856b3b`; most
lab rows were measured on `501fb35`, whose capture code is identical (see "Provenance").

## 1. Headline

**Lab, 564 attempts with exact ground truth:**

| | payload read | request seen, body cut | host named | **silently missed** | at the best possible outcome |
|---|---|---|---|---|---|
| whatleaks before | 33 % | 11 % | 7 % | **48 %** (273) | 41 % |
| **whatleaks after** | 68 % | 1 % | 26 % | **6 %** (32) | **94 %** |
| mitmproxy | 60 % | 0 % | 5 % | **35 %** (195) | 65 % |

- **No false attributions.** In every run, nothing the app did not send was credited to it.
- **Identity detection:**
  - all 8 planted identifiers were found in every run, and all 3 planted in a
    WebSocket message;
  - none of the 4 decoys was flagged.
- **Real tools:** whatleaks matched the tool's own debug output wherever there was one.
  - Next.js on Node 22 and on Node 20: 22 of 22 events, both runs each.
  - Wrangler: 3 of 3 events.
  - Turborepo: 10 of 17 events, the same 10 every run. The other 7 never leave the
    process (section 4).
  - mitmproxy saw nothing from Next.js on Node 20 or from Turborepo, and caught Astro
    in 1 of 2 runs.
- **Linux:** 6 of 6 checks pass in a `node:22-slim` container with no `ps`, `lsof` or
  `netstat`.
- **Cost:**
  - each request costs about 0.3 ms with keep-alive, and about 11 ms when every
    request opens a new TLS connection;
  - a one-request app takes 2.0 s longer to run, 1 s of it the deliberate grace period
    for late senders. The old build took 3.1 s longer.
  - mitmproxy is faster per new connection and per upload and uses less CPU (section 5).

## 2. How the lab works

`bench/run-lab.ts` starts a lab server on the machine's LAN address with its own CA:
HTTP/1.1, WebSocket, HTTP/2, raw TCP and UDP. The lab is reached as an sslip.io name,
so clients make real non-loopback connections that use DNS.

Each scenario is a real client: Node 20, 22 and 26, Bun, curl, Python (urllib,
requests, httpx, aiohttp, Apple's build), Ruby, Go or Java. The client writes every
attempt to a ledger before making it. That ledger is the ground truth. The lab also
logs what actually arrived.

whatleaks runs each scenario through its real CLI, and its HAR and report are scored
per attempt:

| Outcome | Meaning |
|---|---|
| `payload` | the request is in the capture with a byte-identical body (SHA-256) |
| `request` | the request is in the capture, body missing or cut off |
| `host` | not decrypted, but the destination is named (refused, passthrough, direct connection) |
| `missed` | nothing in the output points to it |

"Best possible" is the best outcome a tool can reach without breaking its own rules:
- `payload` for clients that use the proxy;
- `host` for clients that refuse the CA or ignore the proxy. whatleaks never touches
  the system trust store or proxy settings and never gets around pinning (D-04);
- `request` for the 9 MiB upload, which is over the buffering cap by design.

mitmproxy gets the same environment variables whatleaks sets, its own CA and the lab
CA upstream. It runs with default settings and is stopped 10 s after the last client
exits, as a person would stop it.

Runs per scenario: 3 for proxy-aware clients and 10 for timing-dependent ones. Each
row also carries a 95 % Wilson interval in `bench/results/lab-after.md`.

## 3. Lab results per scenario

| Scenario | Best possible | whatleaks before | **whatleaks after** | mitmproxy |
|---|---|---|---|---|
| Node 26 fetch | payload | 100 % | **100 %** | 100 % |
| Node 26 https.request | payload | 100 % | **100 %** | 100 % |
| Node 26 https.request with its own keep-alive Agent | payload | 0 % | **100 %** | 0 % |
| Node 22.23 https.request with its own keep-alive Agent | payload | 0 % | **100 %** | 0 % |
| Node 26 gzip, brotli, zstd bodies | payload | 100 % | **100 %** | 100 % |
| Node 22.23 fetch | payload | 100 % | **100 %** | 100 % |
| Node 22.23 https.request | payload | 100 % | **100 %** | 100 % |
| Node 20 fetch (ignores NODE_USE_ENV_PROXY) | payload | 0 % | **100 %** | 0 % |
| Node 20 https.request (ignores NODE_USE_ENV_PROXY) | payload | 0 % | **100 %** | 0 % |
| Bun fetch | payload | 100 % | **100 %** | 100 % |
| curl (macOS) | payload | 100 % | **100 %** | 100 % |
| curl --http2 | payload | 100 % | **100 %** | 100 % |
| Python 3.14 urllib (Homebrew) | payload | 100 % | **100 %** | 100 % |
| Python requests | payload | 100 % | **100 %** | 100 % |
| Python httpx | payload | 100 % | **100 %** | 100 % |
| Apple /usr/bin/python3 urllib (LibreSSL) | host | 100 % | **100 %** | 100 % |
| Ruby 2.6 Net::HTTP (macOS system) | host | 100 % | **100 %** | 100 % |
| Go 1.26 net/http | host | 100 % | **100 %** | 100 % |
| Java 25 HttpClient | payload | 0 % | **100 %** | 0 % |
| Node WebSocket, 2 messages | payload | 100 % | **100 %** | 100 % |
| Node WebSocket, 20 messages | payload | 15 % | **100 %** | 100 % |
| 9 MiB upload | request | 100 % | **100 %** | 100 % |
| client pinning its own trust store | host | 100 % | **100 %** | 100 % |
| Node http2 module | host | 0 % | **100 %** | 0 % |
| Python aiohttp (trust_env=False) | host | 0 % | **90 %** | 0 % |
| raw TCP held 10 ms | host | 0 % | **100 %** | 0 % |
| raw TCP held 100 ms | host | 0 % | **100 %** | 0 % |
| raw TCP held 500 ms | host | 20 % | **100 %** | 0 % |
| raw TCP held 2 s | host | 100 % | **100 %** | 0 % |
| raw TCP reset by the client after 10 ms | host | 0 % | **10 %** | 0 % |
| raw TCP reset by the client after 50 ms | host | 0 % | **100 %** | 0 % |
| raw TCP reset by the client after 200 ms | host | 0 % | **100 %** | 0 % |
| raw TCP, server closes at once (client socket lives ~1 ms) | host | 0 % | **0 %** | 0 % |
| one UDP datagram, connected socket (like QUIC) | host | 0 % | **100 %** | 0 % |
| one UDP datagram, unconnected socket (sendto) | host | 0 % | **0 %** | 0 % |
| detached helper sends 0.2 s after the app exits | payload | 100 % | **100 %** | 100 % |
| detached helper sends 1.5 s after the app exits | payload | 0 % | **100 %** | 100 % |
| detached helper sends 3 s after the app exits | payload | 0 % | **100 %** | 100 % |
| detached helper sends 8 s after the app exits | payload | 0 % | **100 %** | 100 % |
| grandchild sends after its parent exited | payload | 100 % | **100 %** | 100 % |
| child process lives ~100 ms and connects directly | host | 0 % | **100 %** | 0 % |
| body with this machine's identifiers and decoys | payload | 100 % | **100 %** | 100 % |
| identifiers in the 5th of 6 WebSocket messages | payload | 50 % | **100 %** | 100 % |

### Where whatleaks still misses (32 attempts)

All the remaining misses are connections that bypass the proxy and disappear before a
poll sees them:
- they leave no closed-socket record behind (a reset, or the server closing first);
- or they never had a remote address (UDP sent with `sendto()`).

The timing-dependent rows varied between runs (all builds since `4da3fc6`):

| Scenario | Runs (10 attempts each, aiohttp 30) |
|---|---|
| reset after 10 ms | 10 %, 40 %, 30 %, 10 % |
| aiohttp | 50 %, 50 %, 90 % |
| server closes at once | 0 % to 40 % |
| `node:http2` (the server closes first after GOAWAY) | 60 %, 60 %, 100 %, 100 % |
| one connected UDP datagram (UDP read every 2nd poll since `f80a1be`) | 90 %, 70 %, 100 % |

The lab's server is on the same machine, so these connections close within a few
milliseconds. Over the internet a TLS request takes several round trips, which is the
"reset after 50 ms" row: 100 %.

## 4. Real tools

`bench/run-real.ts` runs each tool four ways:
- with its debug mode, which prints events and sends nothing (the ground truth);
- twice with defaults;
- once with `DO_NOT_TRACK=1`;
- once with its documented opt-out.

Then it runs the tool under mitmproxy, and while phonehome watches. These runs sent
each tool's real telemetry from this Mac.

| Tool | Ground truth (debug) | whatleaks, 2 default runs | DO_NOT_TRACK=1 | Opt-out | mitmproxy | phonehome |
|---|---|---|---|---|---|---|
| Next.js 16.4.2 `next build`, Node 22.23 | 22 events | 22, 22 (8 requests) | still sends 22 | 0 | 22 | destination seen, not labelled |
| Next.js 16.4.2 `next build`, Node 20 | 22 events | 22, 22 | still sends 22 | 0 | **0** (Node 20 ignores the proxy) | destination seen, not labelled |
| Turborepo 2.11.10 `turbo run build` | 17 events | 10, 10 (1 request) | 0 | 0 | **0** (also with `connection_strategy=lazy`) | not seen |
| Astro 7.4.1 `astro build` | none printed (see below) | 1, 1 | still sends 1 | 0 | 1 in this run, 0 in an earlier one | not seen |
| Wrangler 4.151.3 `wrangler whoami` | 3 events | 3, 3 | 0 | 0 | 3 | destination seen, not labelled |

**Turborepo.** The 7 missing events never leave the process: turbo exits about 20 ms
after starting its last request (see `docs/e2e/README.md` §2). mitmproxy connects
upstream before it answers the client's CONNECT, which takes longer than turbo waits.
So mitmproxy sees no turbo event at all, even with `connection_strategy=lazy`.
whatleaks answers at once.

**Astro.** `DEBUG=astro:telemetry` printed nothing on 7.4.1. The debug hook is installed
by a logger module that `astro build` does not load, so Astro sent the event instead of
printing it. The ground truth there is the agreement between whatleaks and mitmproxy
(lazy): 1 event. whatleaks also flagged that the event carries a hash of the project
folder path.

**DO_NOT_TRACK.** The results match each tool's documentation, as checked from its source:
- Next.js and Astro document no `DO_NOT_TRACK` support, and still send with it set;
- Turborepo and Wrangler honour it.

**phonehome** samples connections once a second. It named the telemetry destination for
3 of 5 tools and missed the short-lived ones. It never labelled one as telemetry and
cannot show contents.

Result file: `bench/results/real-after.json`. The mitmproxy lazy run is in
`bench/results/real-mitm-lazy.json`.

## 5. Cost

`bench/run-perf.ts` uses one Node https client against the lab and runs it three ways:
direct, under whatleaks and under mitmproxy. Old and new builds were run back to back.
The load average was about 10.

| Workload | direct p50 / p95 | whatleaks after | whatleaks before | mitmproxy |
|---|---|---|---|---|
| 300 × 1 KiB POST, keep-alive | 0.2 / 0.3 ms | 0.5 / 1.5 ms | 0.5 / 1.1 ms | 1.3 / 2.2 ms |
| 100 × 1 KiB POST, new TLS connection each | 5.7 / 9.6 ms | 17.2 / 29.7 ms | 14.5 / 19.5 ms | 13.7 / 24.1 ms |
| 10 × 4 MiB POST, throughput | 146 MiB/s | 74 MiB/s | 92 MiB/s, then never finished its report | 214 MiB/s |

| Workload | whatleaks after | whatleaks before | mitmproxy |
|---|---|---|---|
| keep-alive: CPU s / peak RSS | 2.2 s / 149 MiB | 2.2 s / 147 MiB | 1.1 s / 90 MiB |
| new connection each: CPU s / peak RSS | 3.9 s / 256 MiB | 3.0 s / 187 MiB | 1.6 s / 88 MiB |
| 4 MiB uploads: CPU s / peak RSS | 3.4 s / 521 MiB | killed after 300 s | 0.8 s / 301 MiB |

How to read the CPU and memory rows:
- whatleaks' CPU is its total minus the bare client's.
- Its RSS is the largest process it waited for, so it can include the app.
- whatleaks keeps every body it buffers (up to 8 MiB) for analysis, which mitmproxy's
  dump does not.

The new build costs more CPU per new connection than the old one. Each new socket
switches the direct-connection watcher to 20 ms polling (D-30). That buys the lab rows
from "raw TCP held 100 ms" down.

**Startup and exit**, one-request app, median of 10:

| | bare | after | before |
|---|---|---|---|
| wall time | 90 ms | 2132 ms | 3196 ms |

1 s of that is the grace period that catches late senders (`--grace`). The rest is
startup and analysis:
- loading mockttp, about 0.5 s;
- a fresh CA, about 0.1 s;
- the loopback-only safety probe, which used to wait 1 s on VPN and AirDrop interfaces.

## 6. Linux

`bench/linux/check.mjs` ran in `node:22-slim`, which has no `ps`, `lsof`, `netstat` or
curl. It runs the real CLI against real hosts:

| Check | Result |
|---|---|
| Node fetch captured with its body | pass |
| `node:http2` (ignores the proxy) named as a direct connection | pass |
| raw TCP held 10 ms named, 20 runs | 20 of 20 |
| detached helper sending 2 s after its parent exited | pass |
| a finished helper left as a zombie (PID 1 never reaps) is not waited for | 4.3 s; the pre-fix build took 10.9 s |
| process tree and watcher work with no tools installed | pass |

Output: `bench/results/linux-check.txt`.

## 7. What the benchmark found and fixed

Every row below was a gap the benchmark measured, fixed and then measured again. The
decision entries give the reasoning.

| Gap | Fix | Commit |
|---|---|---|
| Java ignores proxy variables: 0 % | `JAVA_TOOL_OPTIONS` and a JKS truststore written in-process (D-26) | `63645f9` |
| Node < 22.21 bypassed the proxy: 0 % | `NODE_OPTIONS` preload with CONNECT tunnels (D-25) | `1d0885b` |
| An app's own `https.Agent` bypassed the proxy on new Node: 0 % | the preload gives app-made agents `proxyEnv` (D-29) | `f80200a` |
| One-datagram UDP at 30 % after polling UDP every 4th time | UDP read every 2nd poll | `f80a1be` |
| `whatleaks run -- x \| tail` waited the full linger for `tail` (found while measuring startup) | only real subreapers and higher pids | `3d21e93` |
| Short direct connections missed: 0 to 20 % | macOS `netstat` watcher plus a closing sweep (D-27); adaptive 20/100 ms polling (D-30) | `bc39791`, `4da3fc6` |
| Short-lived children unattributed: 0 % | sockets kept by pid, the pid looked up while it is alive | `bc39791` |
| Helpers sending 1.5 s or later after exit: 0 % | orphans started in the app's folder are waited for | `ac7fab7` |
| WebSockets: 20 messages 15 %, identifiers in message 5 missed half the time | all messages kept within limits and scanned | `ca4e2ef` |
| Uploads over the cap or abandoned: no body | the first MiB kept and decoded | `dc61fff` |
| Linux without ps, lsof or netstat: no watcher | `/proc` backend (D-28) | `a9e081c` |
| A 1 MiB plain-text upload took hours to report | linear email search | `f052aab` |
| A run took 1 s longer on machines with VPN interfaces | 150 ms loopback probe, scoped link-local addresses | `0d69a9a` |

The independent code review (12 findings) is fixed in `1a5979d`, `4da3fc6`, `f80200a`
and the commits above. It covered:
- process identities that changed between listings on Linux;
- zombies that were waited for;
- an upload memory leak;
- preload hangs;
- pid reuse.

## 8. Threats to validity

- **One machine.** It's a working desktop with a VPN, Wi-Fi that dropped several times,
  and three LAN address changes during the runs. The runner waits out outages and
  reruns any scenario that overlapped one. Perf numbers carry the load average they
  ran under.
- **Same-machine lab.** The lab is on the same machine, so round trips take
  microseconds. That makes direct connections shorter than they would be over the
  internet: a hard case for whatleaks' polling watcher, not an easy one.
- **Two builds in the after file, recorded in its `meta.rerun`.** Most rows ran on
  `501fb35`. The timing-dependent groups (proxy-ignoring, lifecycle, identity) were
  rerun on `6856b3b`, because two hung processes from the perf benchmark loaded the
  first run. The two builds differ in no capture code.
- **Small samples.** There are 3 or 10 runs per scenario. Rows between 0 and 100 %
  have wide intervals, given in `lab-after.md`.
- **mitmproxy runs on defaults.** An expert could tune it. The one setting that plausibly
  matters here, `connection_strategy=lazy`, was measured and did not change the turbo
  result.
- **Real tools change.** The versions are pinned above, and newer releases may behave
  differently.
- **Debug output is not always ground truth.** Debug modes show what a tool *intends*
  to send. Turborepo's shows 17 events and 10 cross the wire, and Astro's printed
  nothing.

## 9. Reproduce

```
npm ci && npm run build
./bench/setup.sh                                   # Go client, Python venv, mitmproxy (all under /tmp/wlb)
npx tsx bench/run-lab.ts --tag after               # about 1.5 h; --resume continues after an interruption
npx tsx bench/run-lab.ts --cli <old>/dist/cli.js --tag before
npx tsx bench/summarize.ts                         # writes bench/results/lab-summary.md
npx tsx bench/run-perf.ts --tag after
npx tsx bench/run-real.ts --tag after              # sends real telemetry; needs the scratch apps in bench/real/tools.ts
docker run --rm -v "$PWD":/w:ro -w /tmp node:22-slim node /w/bench/linux/check.mjs
```

Provenance of every result file is in its `meta`: build, date, machine, load and
reruns.
