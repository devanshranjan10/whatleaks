# Benchmark

What whatleaks catches, what it misses, and what it costs, measured against ground
truth and against three tools people use today:
- [mitmproxy](https://mitmproxy.org) 12.2.3, run with the same proxy and CA variables
  whatleaks sets;
- [HTTP Toolkit](https://httptoolkit.com) server v1.27.3, driven the way its desktop
  app drives it: a session with the app's start options, and its "existing terminal"
  setup script, which sets proxy and CA variables plus its own Node, Python, Ruby and
  Java hooks;
- [zyralab/phonehome](https://github.com/zyralab/phonehome) at commit `946f42d`, a
  per-process connection watcher (real tools only).

Everything was run on 2026-10-21 and 2026-10-22:
- **macOS:** the developer's Mac, macOS 26.6.2, Apple Silicon, 8 cores. It's a working
  desktop, not an idle bench box: load average 4 to 18 during the runs.
- **Linux:** Debian in Docker on the same Mac (linuxkit arm64 VM, 4 CPUs), with Node 20,
  22 and 26, Python, Go and OpenJDK 17.

Every number comes from a script in `bench/` and a result file in `bench/results/`. The
design is in `docs/superpowers/specs/2026-10-21-whatleaks-bench-design.md` (D-24).

"Before" is the build at the start of this work (`8c6baa0`). "After" is the current
capture code; which build measured which row is under "Provenance" (section 8).

## 1. Headline

**Lab, exact ground truth: 564 attempts on macOS, 537 on Linux.**

| macOS | payload read | request seen, body cut | host named | **silently missed** | at the best possible outcome |
|---|---|---|---|---|---|
| whatleaks before | 33 % | 11 % | 7 % | **48 %** (273) | 38 % |
| **whatleaks** | 78 % | 1 % | 17 % | **5 %** (27) | **95 %** |
| mitmproxy | 60 % | 0 % | 5 % | **35 %** (195) | 62 % |
| HTTP Toolkit | 32 % | 0 % | 2 % | **65 %** (369) | 35 % |

| Linux | payload read | request seen, body cut | host named | **silently missed** | at the best possible outcome |
|---|---|---|---|---|---|
| **whatleaks** | 78 % | 1 % | 16 % | **5 %** (27) | **95 %** |
| mitmproxy | 63 % | 0 % | 1 % | **36 %** (195) | 64 % |
| HTTP Toolkit | 31 % | 0 % | 1 % | **69 %** (369) | 31 % |

- **whatleaks reached the best possible outcome in every scenario where another tool
  did.** In no scenario did a baseline read a payload whatleaks only named. The one row
  where a baseline went past whatleaks is the 9 MiB upload: mitmproxy kept the whole
  body, and whatleaks caps buffering at 8 MiB by design.
- **No false attributions.** In every run, nothing the app did not send was credited to it.
- **Identity detection:**
  - all 8 planted identifiers were found in every run, and all 3 planted in a
    WebSocket message;
  - none of the 4 decoys was flagged.
- **Real tools:** whatleaks matched the ground truth for 5 of 5 tools, HTTP Toolkit
  for 4 and mitmproxy for 3 (section 4).
- **Cost:** see section 5. Per new TLS connection whatleaks is now the fastest of the
  three proxies. It's the slowest on large uploads, and it uses more CPU than the others
  because it also watches for connections that bypass the proxy.

## 2. How the lab works

`bench/run-lab.ts` starts a lab server on the machine's LAN address with its own CA:
HTTP/1.1, WebSocket, HTTP/2, raw TCP and UDP. The lab is reached as an sslip.io name,
so clients make real non-loopback connections that use DNS.

Each scenario is a real client: Node 20, 22 and 26, Bun, curl, Python (urllib,
requests, httpx, aiohttp, Apple's build), Ruby, Go or Java. The client writes every
attempt to a ledger before making it. That ledger is the ground truth. The lab also
logs what actually arrived.

Each tool runs every scenario through its real interface. whatleaks's HAR and report,
mitmproxy's dump and HTTP Toolkit's event stream are scored per attempt:

| Outcome | Meaning |
|---|---|
| `payload` | the request is in the capture with a byte-identical body (SHA-256) |
| `request` | the request is in the capture, body missing or cut off |
| `host` | not decrypted, but the destination is named (refused, passthrough, direct connection) |
| `missed` | nothing in the output points to it |

"Best possible" is the best outcome whatleaks can reach without breaking its own rules:
- `payload` for clients that use the proxy, or that whatleaks's hooks route to it;
- `host` for clients that refuse the CA or ignore the proxy. whatleaks never touches
  the system trust store or proxy settings and never gets around pinning (D-04);
- `request` for the 9 MiB upload, which is over the buffering cap by design.

Every column is scored against the same expectation, including the old build's. For
example, Apple's Python expects a payload, so a build that only named its host scores
0 % on that row (`bench/summarize.ts`).

Baselines:
- **mitmproxy** gets the same environment variables whatleaks sets, its own CA and the
  lab CA upstream. It runs with default settings.
- **HTTP Toolkit**'s official server release runs with a private config folder. Each
  scenario gets a fresh session and its existing-terminal variables. The lab CA is
  trusted the way public roots are.
- Both are stopped 10 s after the last client exits, as a person would stop them.

Runs per scenario: 3 for proxy-aware clients and 10 for timing-dependent ones. Each
row also carries a 95 % Wilson interval in `bench/results/lab-after.md` and
`lab-linux.md`.

## 3. Lab results per scenario (macOS)

Share of attempts at the best possible outcome. The Linux table is in section 6.

| Scenario | Best possible | whatleaks before | **whatleaks** | mitmproxy | HTTP Toolkit |
|---|---|---|---|---|---|
| Node 26 fetch | payload | 100 % | **100 %** | 100 % | 0 % |
| Node 26 https.request | payload | 100 % | **100 %** | 100 % | 100 % |
| Node 26 https.request with its own keep-alive Agent | payload | 0 % | **100 %** | 0 % | 100 % |
| Node 22.23 https.request with its own keep-alive Agent | payload | 0 % | **100 %** | 0 % | 100 % |
| Node 26 gzip, brotli, zstd bodies | payload | 100 % | **100 %** | 100 % | 100 % |
| Node 22.23 fetch | payload | 100 % | **100 %** | 100 % | 100 % |
| Node 22.23 https.request | payload | 100 % | **100 %** | 100 % | 100 % |
| Node 20 fetch (ignores NODE_USE_ENV_PROXY) | payload | 0 % | **100 %** | 0 % | 100 % |
| Node 20 https.request (ignores NODE_USE_ENV_PROXY) | payload | 0 % | **100 %** | 0 % | 100 % |
| Bun fetch | payload | 100 % | **100 %** | 100 % | 100 % |
| curl (macOS) | payload | 100 % | **100 %** | 100 % | 100 % |
| curl --http2 | payload | 100 % | **100 %** | 100 % | 100 % |
| Python 3.14 urllib (Homebrew) | payload | 100 % | **100 %** | 100 % | 100 % |
| Python requests | payload | 100 % | **100 %** | 100 % | 100 % |
| Python httpx | payload | 100 % | **100 %** | 100 % | 100 % |
| Apple /usr/bin/python3 urllib (LibreSSL) | payload | 0 % | **100 %** | 0 % | 100 % |
| Ruby 2.6 Net::HTTP (macOS system) | payload | 0 % | **100 %** | 0 % | 100 % |
| Go 1.26 net/http (reads only the keychain) | host | 100 % | **100 %** | 100 % | 100 % |
| Java 25 HttpClient | payload | 0 % | **100 %** | 0 % | 100 % |
| Node WebSocket, 2 messages | payload | 100 % | **100 %** | 100 % | 0 % |
| Node WebSocket, 20 messages | payload | 15 % | **100 %** | 100 % | 0 % |
| 9 MiB upload | request | 100 % | **100 %** | 100 % | 0 % |
| client pinning its own trust store | host | 100 % | **100 %** | 100 % | 100 % |
| Node http2 module (ignores proxy variables) | payload | 0 % | **100 %** | 0 % | 0 % |
| Python aiohttp (ignores proxy variables by default) | payload | 0 % | **100 %** | 0 % | 100 % |
| raw TCP held 10 ms | host | 0 % | **100 %** | 0 % | 0 % |
| raw TCP held 100 ms | host | 0 % | **100 %** | 0 % | 0 % |
| raw TCP held 500 ms | host | 20 % | **100 %** | 0 % | 0 % |
| raw TCP held 2 s | host | 100 % | **100 %** | 0 % | 0 % |
| raw TCP reset by the client after 10 ms | host | 0 % | **20 %** | 0 % | 0 % |
| raw TCP reset by the client after 50 ms | host | 0 % | **100 %** | 0 % | 0 % |
| raw TCP reset by the client after 200 ms | host | 0 % | **100 %** | 0 % | 0 % |
| raw TCP, server closes at once (client socket lives ~1 ms) | host | 0 % | **10 %** | 0 % | 0 % |
| one UDP datagram, connected socket (like QUIC) | host | 0 % | **100 %** | 0 % | 0 % |
| one UDP datagram, unconnected socket (sendto) | host | 0 % | **0 %** | 0 % | 0 % |
| detached helper sends 0.2 s after the app exits | payload | 100 % | **100 %** | 100 % | 0 % |
| detached helper sends 1.5 s after the app exits | payload | 0 % | **100 %** | 100 % | 0 % |
| detached helper sends 3 s after the app exits | payload | 0 % | **100 %** | 100 % | 0 % |
| detached helper sends 8 s after the app exits | payload | 0 % | **100 %** | 100 % | 0 % |
| grandchild sends after its parent exited | payload | 100 % | **100 %** | 100 % | 0 % |
| child process lives ~100 ms and connects directly | host | 0 % | **100 %** | 0 % | 0 % |
| body with this machine's identifiers and decoys | payload | 100 % | **100 %** | 100 % | 0 % |
| identifiers in the 5th of 6 WebSocket messages | payload | 50 % | **100 %** | 100 % | 0 % |

### Where whatleaks still misses (27 attempts on each platform)

All the remaining misses are connections that bypass the proxy and disappear before a
poll sees them:
- they close within about 10 ms and leave no closed-socket record behind (a reset, or
  the server closing first);
- or they never had a remote address (UDP sent with `sendto()`).

No other tool here names any of them. Seeing them would take a kernel-level hook
(eBPF, a network extension), and whatleaks avoids that because it needs neither root
nor installation (D-04).

The timing-dependent rows vary between runs:

| Scenario | macOS runs (10 attempts each) | Linux |
|---|---|---|
| reset after 10 ms | 10 %, 40 %, 30 %, 10 %, 20 % | 50 % |
| server closes at once | 0 % to 40 % | 20 % |
| raw TCP held 10 ms | 100 % | 60 %; a check with 20 runs to example.com: 20 of 20 |

The lab's server is on the same machine, so these connections close within a few
milliseconds. Over the internet a TLS request takes several round trips, which is the
"reset after 50 ms" row: 100 % on both platforms.

### Where the baselines miss

- **mitmproxy** sees only clients that read proxy variables and trust its CA. It misses
  Node 20, app-made Node agents, Java, Apple's Python and the system Ruby (refused, and
  not named), aiohttp, `node:http2`, and every direct connection.
- **HTTP Toolkit**'s hooks cover more clients than mitmproxy: Node 20, app-made agents,
  Java, Apple's Python, the system Ruby and aiohttp. With v1.27.3 on Node 26, the
  built-in `fetch` and `WebSocket` went around it. That covers the Node 26 rows, the 9
  MiB upload, the helpers and the identity rows, which all use `fetch`. Node 22's
  `fetch` was caught. It has no watcher for direct connections.

## 4. Real tools

`bench/run-real.ts` runs each tool four ways:
- with its debug mode, which prints events and sends nothing (the ground truth);
- twice with defaults;
- once with `DO_NOT_TRACK=1`;
- once with its documented opt-out.

Then it runs the tool under mitmproxy and under HTTP Toolkit, and while phonehome
watches. These runs sent each tool's real telemetry from this Mac.

| Tool | Ground truth (debug) | whatleaks, 2 default runs | DO_NOT_TRACK=1 | Opt-out | mitmproxy | HTTP Toolkit | phonehome |
|---|---|---|---|---|---|---|---|
| Next.js 16.4.2 `next build`, Node 22.23 | 22 events | 22, 22 (8 requests) | still sends 22 | 0 | 22 | 22 | destination seen, not labelled |
| Next.js 16.4.2 `next build`, Node 20 | 22 events | 22, 22 | still sends 22 | 0 | **0** (Node 20 ignores the proxy) | 22 | destination seen, not labelled |
| Turborepo 2.11.10 `turbo run build` | 17 events | 10, 10 (1 request) | 0 | 0 | **0** (also with `connection_strategy=lazy`) | 10 | not seen |
| Astro 7.4.1 `astro build` | none printed (see below) | 1, 1 | still sends 1 | 0 | 1 in this run, 0 in an earlier one | **0** (Node 26 `fetch`) | not seen |
| Wrangler 4.151.3 `wrangler whoami` | 3 events | 3, 3 | 0 | 0 | 3 | 3 | destination seen, not labelled |

**Turborepo.** The 7 missing events never leave the process: turbo exits about 20 ms
after starting its last request (see `docs/e2e/README.md` §2). mitmproxy connects
upstream before it answers the client's CONNECT, which takes longer than turbo waits.
So mitmproxy sees no turbo event at all, even with `connection_strategy=lazy`.
whatleaks answers at once. HTTP Toolkit also caught the 10.

**Astro.** `DEBUG=astro:telemetry` printed nothing on 7.4.1. The debug hook is installed
by a logger module that `astro build` does not load, so Astro sent the event instead of
printing it. The ground truth there is the agreement between whatleaks and mitmproxy:
1 event. whatleaks also flagged that the event carries a hash of the project folder
path.

**DO_NOT_TRACK.** The results match each tool's documentation, as checked from its source:
- Next.js and Astro document no `DO_NOT_TRACK` support, and still send with it set;
- Turborepo and Wrangler honour it.

**phonehome** samples connections once a second. It named the telemetry destination for
3 of 5 tools and missed the short-lived ones. It never labelled one as telemetry and
cannot show contents.

Result file: `bench/results/real-after.json`. The mitmproxy lazy run is in
`bench/results/real-mitm-lazy.json`.

## 5. Cost

`bench/run-perf.ts` uses one Node https client against the lab and runs it four ways:
directly, under whatleaks, under mitmproxy and under HTTP Toolkit. Load average 3.3
(`bench/results/perf-after.md`).

| Workload | direct p50 / p95 | **whatleaks** | mitmproxy | HTTP Toolkit |
|---|---|---|---|---|
| 300 × 1 KiB POST, keep-alive | 0.2 / 0.5 ms | **0.6 / 2.7 ms** | 1.2 / 1.5 ms | 13.4 / 25.9 ms |
| 100 × 1 KiB POST, new TLS connection each | 5.9 / 11.1 ms | **9.4 / 17.8 ms** | 13.6 / 20.2 ms | 13.4 / 29.4 ms |
| 10 × 4 MiB POST, throughput | 386 MiB/s | **79 MiB/s** | 205 MiB/s | 88 MiB/s |

| Workload: CPU s / peak RSS | **whatleaks** | mitmproxy | HTTP Toolkit |
|---|---|---|---|
| keep-alive | 2.1 s / 168 MiB | 0.9 s / 91 MiB | 2.9 s / 344 MiB |
| new connection each | 2.5 s / 143 MiB | 1.6 s / 88 MiB | 1.0 s / 312 MiB |
| 4 MiB uploads | 3.6 s / 492 MiB | 0.7 s / 302 MiB | 0.6 s / 351 MiB |

How to read these:
- whatleaks's CPU is its total minus the bare client's. It includes its startup (mockttp,
  a fresh CA) and the direct-connection watcher, which polls every 20 ms while the app
  is busy (D-30). The other tools have no such watcher.
- Its RSS is the largest process it waited for, so it can include the app.
- whatleaks keeps every body it buffers (up to 8 MiB) for analysis.
- Before D-33, a new connection cost p50 18.9 ms and 4.3 s of CPU per 100. Sharing
  upstream TLS contexts halved the latency.
- Uploads are slower than mitmproxy's partly because mockttp's body-data events copy
  the pending buffer once per chunk (D-33). The fix belongs in mockttp.

**Startup and exit**, one-request app, median of 10: bare 89 ms, under whatleaks
2143 ms. The build before this work took 3196 ms in the first round. (Its rerun in this
round ran at load average 10.6, with the bare app at 372 ms, so it isn't comparable.)

1 s of that is the grace period that catches late senders (`--grace`). The rest is
startup and analysis:
- loading mockttp, about 0.5 s;
- a fresh CA, about 0.1 s;
- the loopback-only safety probe.

## 6. Linux

**Lab.** `bench/linux/lab.sh` builds a Debian image with the runtimes and runs the same
lab inside Docker, against this checkout's `dist/`. Bun, Apple's Python and the system
Ruby are macOS-only rows. Totals are in section 1; the rows that differ from macOS:

| Scenario | Best possible | **whatleaks** | mitmproxy | HTTP Toolkit |
|---|---|---|---|---|
| Go 1.26 net/http (reads `SSL_CERT_FILE` on Linux) | payload | **100 %** | 100 % | 100 % |
| Java 17 HttpClient (OpenJDK) | payload | **100 %** | 0 % | 100 % |
| raw TCP held 10 ms | host | **60 %** | 0 % | 0 % |
| raw TCP reset by the client after 10 ms | host | **50 %** | 0 % | 0 % |
| raw TCP, server closes at once | host | **20 %** | 0 % | 0 % |

Every other row matches macOS for whatleaks. On Linux a closed socket has no owner in
`/proc`, so a direct connection is named only if a poll sees it open. That's why the
10 ms row is lower than on macOS, where TIME_WAIT keeps the owner. Full table:
`bench/results/lab-summary-linux.md`.

**No tools installed.** `bench/linux/check.mjs` runs in `node:22-slim`, which has no
`ps`, `lsof`, `netstat` or curl, against real hosts:

| Check | Result |
|---|---|
| Node fetch captured with its body | pass |
| `node:http2` (ignores the proxy) captured through the preload | pass |
| raw TCP held 10 ms named, 20 runs | 20 of 20 |
| detached helper sending 2 s after its parent exited | pass |
| a finished helper left as a zombie (PID 1 never reaps) is not waited for | 6.0 s; the pre-fix build took 10.9 s |
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
| Apple's Python and the system Ruby refused the CA; aiohttp ignored the proxy: host only, 50 to 90 % | Python and Ruby hooks (D-31), found by the HTTP Toolkit baseline | `adb4968` |
| `node:http2` ignores the proxy on every Node: host only, 60 to 100 % | the preload tunnels it (D-32) | `a152a58` |
| A new TLS connection cost about 6 ms of CPU in the proxy | shared upstream TLS contexts (D-33) | `110f4f9` |
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

The harness had bugs of its own, fixed before these numbers were taken:
- the curl client hashed with `shasum`, which Debian lacks, so every tool scored
  "request" on Linux curl;
- the summary credited the old build with expectations that later rows raised;
- the perf client crashed when HTTP Toolkit replaced Node's global agent.

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
- **Linux runs in a VM.** Docker on macOS runs a linuxkit VM, not a bare-metal Linux
  machine. The `/proc` watcher and the runtimes are real Linux; timing may differ.
- **Same-machine lab.** The lab is on the same machine, so round trips take
  microseconds. That makes direct connections shorter than they would be over the
  internet: a hard case for whatleaks's polling watcher, not an easy one.
- **Provenance.** Each result file records its reruns in `meta.rerun`:
  - macOS: every row ran on `e38c907`. The Python and Ruby rows were rerun on `3774b7f`,
    whose pinned build ships the hooks, and `node:http2` on `a152a58`.
  - Linux: `3774b7f`. curl and `node:http2` were rerun on `a152a58`.
  - The capture code in those builds differs only by the change each rerun measures.
- **Small samples.** There are 3 or 10 runs per scenario. Rows between 0 and 100 %
  have wide intervals, given in `lab-after.md` and `lab-linux.md`.
- **Baselines run on defaults.** An expert could tune mitmproxy or HTTP Toolkit. For
  mitmproxy, the one setting that plausibly matters here, `connection_strategy=lazy`,
  was measured and did not change the turbo result. HTTP Toolkit was driven by its
  terminal script, not its desktop app's launchers for specific apps.
- **Real tools change.** The versions are pinned above, and newer releases may behave
  differently.
- **Debug output is not always ground truth.** Debug modes show what a tool *intends*
  to send. Turborepo's shows 17 events and 10 cross the wire, and Astro's printed
  nothing.

## 9. Reproduce

```
npm ci && npm run build
./bench/setup.sh                                   # Go client, Python venv, mitmproxy, HTTP Toolkit server (all under /tmp/wlb)
npx tsx bench/run-lab.ts --tag after --tools whatleaks,mitmproxy,httptoolkit   # about 2 h; --resume continues
npx tsx bench/run-lab.ts --cli <old>/dist/cli.js --tag before
npx tsx bench/summarize.ts                         # writes bench/results/lab-summary.md
bench/linux/lab.sh --tag linux --tools whatleaks,mitmproxy,httptoolkit
npx tsx bench/summarize.ts --after linux
npx tsx bench/run-perf.ts --tag after
npx tsx bench/run-real.ts --tag after              # sends real telemetry; needs the scratch apps in bench/real/tools.ts
docker run --rm -v "$PWD":/w:ro -w /tmp node:22-slim node /w/bench/linux/check.mjs
```

Provenance of every result file is in its `meta`: build, date, machine, load and
reruns.
