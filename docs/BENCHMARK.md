# Benchmark

What whatleaks catches, what it misses, and what it costs, measured against ground
truth and against three tools people use today:
- [mitmproxy](https://mitmproxy.org) 12.2.3 (12.3.0 in the Linux image), run with the same proxy and CA variables
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

"Before" is the build at the start of this work (`7460cb5`). "After" is:
`22d85d3` for every lab row on both platforms and for the cost runs.

## 1. Headline

**Lab, exact ground truth: 46 scenarios and 594 attempts on macOS, 43 and 567 on Linux.**

| macOS | payload read | request seen, body cut | host named | **silently missed** | at the best possible outcome |
|---|---|---|---|---|---|
| whatleaks before (the 43 scenarios it ran) | 33 % | 11 % | 7 % | **48 %** (273 of 564) | 38 % |
| **whatleaks** | 74 % | 0.5 % | 22 % | **3.4 %** (20) | **97 %** |
| mitmproxy | 57 % | 0 % | 5 % | **38 %** (225) | 59 % |
| HTTP Toolkit | 31 % | 0 % | 2 % | **67 %** (399) | 33 % |

| Linux | payload read | request seen, body cut | host named | **silently missed** | at the best possible outcome |
|---|---|---|---|---|---|
| **whatleaks** | 74 % | 1 % | 22 % | **3.0 %** (17) | **97 %** |
| mitmproxy | 60 % | 0 % | 1 % | **40 %** (225) | 60 % |
| HTTP Toolkit | 29 % | 0 % | 1 % | **70 %** (399) | 30 % |

- **Every miss left is a program whatleaks loads no hook into.** On the 43 scenarios
  the old build also ran, whatleaks missed **0 of 564** attempts on macOS. All 20 misses
  on macOS and all 17 on Linux are in rows added to measure that limit, Go programs
  that bypass the proxy:
  - a TCP connection reset after 10 ms;
  - UDP sent with `sendto()`;
  - on macOS in this run, 1 of 10 connections closed at once by the server.

  No other tool here names those either.
- **whatleaks reached the best possible outcome in every scenario where another tool
  did.** In no scenario did a baseline read a payload whatleaks only named. The one row
  where a baseline went past whatleaks is the 9 MiB upload: mitmproxy kept the whole
  body, and whatleaks caps buffering at 8 MiB by design (D-35).
- **No false attributions.** In every run, nothing the app did not send was credited to it.
- **Identity detection:**
  - all 8 planted identifiers were found in every run, and all 3 planted in a
    WebSocket message;
  - none of the 4 decoys was flagged.
- **Real tools:** whatleaks matched the ground truth for 5 of 5 tools, HTTP Toolkit
  for 4 and mitmproxy for 3 (section 4).
- **Cost:** whatleaks had the lowest median latency of the three proxies on keep-alive
  requests and on new TLS connections. Large uploads were roughly even with mitmproxy.
  It uses more CPU than mitmproxy, mostly a fixed second per run (section 5).

## 2. How the lab works

`bench/run-lab.ts` starts a lab server on the machine's LAN address with its own CA:
HTTP/1.1, WebSocket, HTTP/2, raw TCP and UDP. The lab is reached as an sslip.io name,
so clients make real non-loopback connections that use DNS.

Each scenario is a real client: Node 20, 22 and 26, Bun, curl, Python (urllib,
requests, httpx, aiohttp, Apple's build), Ruby, Go or Java. The raw TCP and UDP rows
come in two kinds:
- Node clients, which whatleaks's preload reports as they connect (D-34);
- Go clients, which no whatleaks hook reaches, so only the polling watcher can name them. The client writes every
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
| raw TCP reset by the client after 10 ms | host | 0 % | **100 %** | 0 % | 0 % |
| raw TCP reset by the client after 50 ms | host | 0 % | **100 %** | 0 % | 0 % |
| raw TCP reset by the client after 200 ms | host | 0 % | **100 %** | 0 % | 0 % |
| raw TCP, server closes at once (client socket lives ~1 ms) | host | 0 % | **100 %** | 0 % | 0 % |
| one UDP datagram, connected socket (like QUIC) | host | 0 % | **100 %** | 0 % | 0 % |
| one UDP datagram, unconnected socket (sendto) | host | 0 % | **100 %** | 0 % | 0 % |
| Go raw TCP reset after 10 ms (no runtime hook) | host | – | **10 %** | 0 % | 0 % |
| Go raw TCP, server closes at once (no runtime hook) | host | – | **90 %** | 0 % | 0 % |
| Go UDP datagram, unconnected socket (no runtime hook) | host | – | **0 %** | 0 % | 0 % |
| detached helper sends 0.2 s after the app exits | payload | 100 % | **100 %** | 100 % | 0 % |
| detached helper sends 1.5 s after the app exits | payload | 0 % | **100 %** | 100 % | 0 % |
| detached helper sends 3 s after the app exits | payload | 0 % | **100 %** | 100 % | 0 % |
| detached helper sends 8 s after the app exits | payload | 0 % | **100 %** | 100 % | 0 % |
| grandchild sends after its parent exited | payload | 100 % | **100 %** | 100 % | 0 % |
| child process lives ~100 ms and connects directly | host | 0 % | **100 %** | 0 % | 0 % |
| body with this machine's identifiers and decoys | payload | 100 % | **100 %** | 100 % | 0 % |
| identifiers in the 5th of 6 WebSocket messages | payload | 50 % | **100 %** | 100 % | 0 % |

### Where whatleaks still misses (20 attempts on macOS, 17 on Linux)

Only in programs whatleaks loads no hook into (Go here; also Rust, C and other native
code), and only when their connection bypasses the proxy:
- **a TCP connection reset within about 10 ms:** Go 10 % and 30 % in two macOS runs,
  20 % and 30 % in two Linux runs. The polling watcher must see it while it's open, and a reset leaves
  no closed-socket record behind;
- **UDP sent with `sendto()` on an unconnected socket:** 0 %. The socket never has a
  remote address for any watcher to read.

The same connections from Node, Python or Ruby are reported by whatleaks's runtime hook
as they open: 100 % in the lab (D-34). A Go connection the server closes at once is
usually still named (90 % and 100 % in two macOS runs, 100 % on Linux), because the
client keeps its socket a moment longer.

Seeing every connection from every program would take a kernel-level hook (eBPF, a
network extension). whatleaks avoids that, because it needs neither root nor
installation (D-04).

The lab's server is on the same machine, so these connections close within a few
milliseconds. Over the internet a TLS request takes several round trips; the "reset
after 50 ms" rows are 100 % on both platforms.

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
directly, under whatleaks, under mitmproxy and under HTTP Toolkit. Load average 2.0
(`bench/results/perf-after.md`).

| Workload | direct p50 / p95 | **whatleaks** | mitmproxy | HTTP Toolkit |
|---|---|---|---|---|
| 300 × 1 KiB POST, keep-alive | 0.2 / 0.5 ms | **0.5 / 1.1 ms** | 1.2 / 1.4 ms | 13.3 / 25.1 ms |
| 100 × 1 KiB POST, new TLS connection each | 6.1 / 8.0 ms | **8.5 / 11.1 ms** | 10.7 / 15.7 ms | 13.1 / 28.5 ms |
| 10 × 4 MiB POST, throughput | 406 MiB/s | **211 MiB/s** | 239 MiB/s | 93 MiB/s |

| Workload: CPU s / peak RSS | **whatleaks** | mitmproxy | HTTP Toolkit |
|---|---|---|---|
| keep-alive | 1.5 s / 136 MiB | 0.8 s / 91 MiB | 2.9 s / 338 MiB |
| new connection each | 1.7 s / 127 MiB | 1.2 s / 88 MiB | 1.0 s / 239 MiB |
| 4 MiB uploads | 1.8 s / 305 MiB | 0.7 s / 301 MiB | 0.6 s / 272 MiB |

How to read these:
- **Upload throughput varies from run to run.** Over three runs mitmproxy measured
  160 to 239 MiB/s, and whatleaks 187 and 211 since D-35. Treat uploads as roughly
  even.
- **CPU:** whatleaks's figure is its total minus the bare client's. About 1 s of it is
  a fixed cost per run: loading mockttp, creating a CA, and the watcher's process
  listings during the 1 s wait after the app exits.
- **Memory:** its RSS is the largest process it waited for, so it can include the app.
  It keeps every body it buffers (up to 8 MiB) for analysis.

What changed the numbers:
- **New TLS connections:** p50 from 18.9 to 8.5 ms, because upstream TLS contexts are
  now shared (D-33).
- **Uploads:** 79 to 211 MiB/s, and peak memory from 492 to 305 MiB, because
  mockttp's body-data batching is fixed when whatleaks loads it (D-35).
- **CPU:** 2.1–2.3 s to 1.5–1.8 s per workload, from fast polling only while a process
  without a hook is alive (D-36). An app that does nothing went from 1.5 s to about
  1.05 s.

**Startup and exit**, one-request app, median of 10: bare 92 ms, under whatleaks
1964 ms. The build before this work took 3196 ms.

1 s of that is the grace period that catches late senders (`--grace`). The rest is
startup and analysis:
- loading mockttp, about 0.5 s;
- a fresh CA, about 0.1 s;
- the loopback-only safety probe.

## 6. Linux

**Lab.** `bench/linux/lab.sh` builds a Debian image with the runtimes and runs the same
lab inside Docker, against this checkout's `dist/`. Bun, Apple's Python and the system
Ruby are macOS-only rows. Totals are in section 1. The rows where Linux differs from
macOS:

| Scenario | Best possible | **whatleaks** | mitmproxy | HTTP Toolkit |
|---|---|---|---|---|
| Go 1.26 net/http (reads `SSL_CERT_FILE` on Linux) | payload | **100 %** | 100 % | 100 % |
| Java 17 HttpClient (OpenJDK) | payload | **100 %** | 0 % | 100 % |
| Go raw TCP reset after 10 ms (no runtime hook) | host | **30 %** | 0 % | 0 % |

On Linux a closed socket has no owner in `/proc`, so the polling watcher names a
direct connection only if it sees it open. Before D-34 that left raw TCP held 10 ms
at 60 %. The Node rows are now reported by the preload: 100 %. Full table:
`bench/results/lab-summary-linux.md`.

**No tools installed.** `bench/linux/check.mjs` runs in `node:22-slim`, which has no
`ps`, `lsof`, `netstat` or curl, against real hosts:

| Check | Result |
|---|---|
| Node fetch captured with its body | pass |
| `node:http2` (ignores the proxy) captured through the preload | pass |
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
| Java ignores proxy variables: 0 % | `JAVA_TOOL_OPTIONS` and a JKS truststore written in-process (D-26) | `61bcbae` |
| Node < 22.21 bypassed the proxy: 0 % | `NODE_OPTIONS` preload with CONNECT tunnels (D-25) | `509c6b9` |
| An app's own `https.Agent` bypassed the proxy on new Node: 0 % | the preload gives app-made agents `proxyEnv` (D-29) | `d233414` |
| Apple's Python and the system Ruby refused the CA; aiohttp ignored the proxy: host only, 50 to 90 % | Python and Ruby hooks (D-31), found by the HTTP Toolkit baseline | `69b87eb` |
| `node:http2` ignores the proxy on every Node: host only, 60 to 100 % | the preload tunnels it (D-32) | `d4fb5b0` |
| A new TLS connection cost about 6 ms of CPU in the proxy | shared upstream TLS contexts (D-33) | `9ce8a02` |
| Direct sockets closed within ~10 ms: 10 to 20 % on macOS, 20 to 60 % on Linux; UDP via `sendto()`: 0 % | runtime hooks report each socket as it opens (D-34) | `b2b2051` |
| 4 MiB uploads at 79 MiB/s | mockttp's body-data batching fixed when it loads (D-35) | `b2b2051` |
| Fast polling in every run: an app that does nothing cost 1.5 s of CPU | hooked processes announce themselves; fast polling only while one without a hook is alive (D-36) | `22d85d3` |
| A run could refuse to start ("proxy reachable") when another program held the proxy's port number on a LAN address, or Linux connected the probe to itself (found in the Linux lab) | the probe counts only connections the proxy accepted | `27df68c` |
| One-datagram UDP at 30 % after polling UDP every 4th time | UDP read every 2nd poll | `99861e1` |
| `whatleaks run -- x \| tail` waited the full linger for `tail` (found while measuring startup) | only real subreapers and higher pids | `e837d62` |
| Short direct connections missed: 0 to 20 % | macOS `netstat` watcher plus a closing sweep (D-27); adaptive 20/100 ms polling (D-30) | `fb8a297`, `dd5a676` |
| Short-lived children unattributed: 0 % | sockets kept by pid, the pid looked up while it is alive | `fb8a297` |
| Helpers sending 1.5 s or later after exit: 0 % | orphans started in the app's folder are waited for | `dd74525` |
| WebSockets: 20 messages 15 %, identifiers in message 5 missed half the time | all messages kept within limits and scanned | `19b8276` |
| Uploads over the cap or abandoned: no body | the first MiB kept and decoded | `8d54bc1` |
| Linux without ps, lsof or netstat: no watcher | `/proc` backend (D-28) | `b5c4123` |
| A 1 MiB plain-text upload took hours to report | linear email search | `f4b53a2` |
| A run took 1 s longer on machines with VPN interfaces | 150 ms loopback probe, scoped link-local addresses | `d1d6778` |

The harness had bugs of its own, fixed before these numbers were taken:
- the curl client hashed with `shasum`, which Debian lacks, so every tool scored
  "request" on Linux curl;
- the summary credited the old build with expectations that later rows raised;
- the perf client crashed when HTTP Toolkit replaced Node's global agent.

The independent code review (12 findings) is fixed in `79a4d28`, `dd5a676`, `d233414`
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
- **Provenance.** Both lab platforms and the cost runs used `22d85d3`. The Linux
  image was rebuilt for the final run and installed mitmproxy 12.3.0 (macOS ran
  12.2.3); its Linux totals were the same as with 12.2.3 on the previous build. The
  real-tool runs (section
  4) used `7ee2ac6`; the later changes don't affect traffic that goes through the proxy.
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
