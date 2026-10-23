# Progress

This is the resume point for any session.

Spec: `docs/superpowers/specs/2026-10-21-whatleaks-design.md`.
Plan: `docs/superpowers/plans/2026-10-21-whatleaks.md`.
Decisions: `docs/DECISIONS.md` (D-01 to D-36). Research: `docs/RESEARCH.md`.
Accuracy: `docs/ACCURACY.md`. Real runs: `docs/e2e/README.md`.
Benchmark: `docs/BENCHMARK.md` (spec `docs/superpowers/specs/2026-10-21-whatleaks-bench-design.md`).

## Status

Every milestone is done and committed: M0–M9, plus fixes from the real runs and from an
independent code review.

| Milestone | Commit |
|---|---|
| Research, spec, plan | 423dc60 |
| M0 scaffold | f4b4ed8 |
| M1 HAR model, body decoding, URL templates | a2a8d18 |
| M2 analysis: fields, identity, classify, redact, report | 3edc5b0 |
| M3 renderers and `report` | fd6f346 |
| Catalogs: 69 hosts, 32 opt-outs, all sourced | 2b58f83 |
| M4 diff and `diff --strict` | 3b2c6db |
| M5 capture core and `run` | 4fdcaf6 |
| M6 process tree, linger, direct watcher | 5f88224 |
| M7 `compare` and `opt-outs` | a6ea302 |
| Fixes found by real runs | 0118e90, 790d7ba, 7f073c8 |
| M8 real e2e, recorded fixtures, accuracy | 2c22a62 |
| M9 README and docs | f74f6fd, 017b184, 0ac6b04 |
| Independent review: 20 findings fixed | df98763, 259df1e |

| Benchmark (lab, real tools, perf, Linux) and the gaps it found | 7cbc5bd … 4f937c5; see `docs/BENCHMARK.md` §7 |
| HTTP Toolkit baseline, Linux lab, Python/Ruby hooks, `node:http2`, TLS context sharing | 0a5dc4d … 9ce8a02 |
| Socket reports from the hooks, mockttp upload fix, loopback probe fix | b2b2051, 27df68c |

**Gate on the last commit:** `npm ci`, typecheck, lint, **242 offline tests**, build. It
passes on a fresh `git clone`. Run `./scripts/gate.sh` before committing. It returns
npm's real exit code; an earlier `| grep` pipe hid two lint failures, which were
amended.

The gate passes on macOS with Node 22.12.0, 22.23.4, 24.22.1 and 26.12.0. CI
(`.github/workflows/ci.yml`) runs it on Ubuntu and macOS with Node 22.12.0, 22, 24 and
26, then installs the packed package in an empty directory and captures a real request.
Its first run, the suite's first on Linux, found one bug: Node 24 names its main thread
"MainThread" (Node 26: "node-MainThread"), and on Linux that is the process's name, so a
Node app's connections were attributed to "MainThread". The /proc backend now names such
a process after its executable, as macOS does.

## Launch prep (2026-10-23)

Done: npm metadata (repository, homepage, bugs, author); `prepack` builds and
`prepublishOnly` runs the gate; README installs from npm; CI and release workflows,
modelled on landmine's; commit emails rewritten to the GitHub noreply address (backup in
`../.git-backups/whatleaks-before-email-rewrite.bundle`; every tree unchanged, and the
doc citations follow the new hashes). `npm publish --dry-run` passes.

The Python hook's bytecode cache had been committed (from `69b87eb` on), and it recorded
the absolute path of the machine it was compiled on. It is out of every commit now
(backup in `../.git-backups/whatleaks-before-pycache-rewrite.bundle`): the trees differ
only by that file, commit messages and doc citations follow the new hashes, and no blob in
the history holds the machine's username or a personal email.

The release workflow skips a version npm already has, so tagging a version published by
hand is not a failure, and it runs on Node 24, whose npm can use trusted publishing. A
GitHub Packages mirror (`@devanshranjan10/whatleaks`) publishes with each GitHub release,
as landmine's does.

---

## Benchmark session, third round (2026-10-22)

The owner asked for every remaining gap to be fixed.
- **Short direct sockets and `sendto()`:** the Node, Python and Ruby hooks now report
  each TCP connection and UDP destination as it opens (D-34). Lab: every Node raw
  socket row is 100 % on both platforms. Previously a reset after 10 ms was 10–50 %,
  server-closes 0–40 % and `sendto()` 0 %.
- **New lab rows** for the same sockets from Go, which has no hook. They keep the limit
  measured: reset after 10 ms 20–30 %, `sendto()` 0 %.
- **Silently missed, macOS / Linux:** whatleaks **3.4 % / 3.0 %**, all in those Go
  rows. On the old build's 43 scenarios: 0 of 564. mitmproxy 38 % / 40 %, HTTP Toolkit
  67 % / 70 %.
- **Uploads:** 79 → 211 MiB/s, by fixing mockttp's body-data batching when whatleaks
  loads it (D-35). The fix should also go upstream to mockttp.
- **CPU:** fast polling only while a process without a hook is alive (D-36). An empty
  run went from 1.5 s to about 1.05 s of CPU, and each perf workload is about 20 %
  lower.
- **Both platforms on `22d85d3`.** The first Linux rerun stopped when the Mac's disk
  filled up; it was rerun after clearing Docker's build cache.
- **Found by the Linux lab:** the loopback probe refused to run when another listener
  held the proxy's port number on a LAN address (`27df68c`).
- **Kept by design:** bodies over 8 MiB are cut off (bounded memory), and whatleaks
  uses the most CPU of the three proxies (the polling watcher).

## Benchmark session, second round (2026-10-21 evening to 2026-10-22)

The owner wants to claim the results publicly. Results are in `docs/BENCHMARK.md`.
- **New baseline: HTTP Toolkit** server v1.27.3, driven like its desktop app.
- **Lab on Linux** in Docker, with all three tools.
- **Silently missed, macOS / Linux:** whatleaks **5 % / 5 %**, mitmproxy 35 % / 36 %,
  HTTP Toolkit 65 % / 69 %. No baseline reached a better outcome than whatleaks in any
  scenario, except mitmproxy keeping all of a 9 MiB upload (whatleaks caps at 8 MiB by
  design).
- **Real tools:** whatleaks 5 of 5, HTTP Toolkit 4, mitmproxy 3.
- **Fixed:**
  - Apple's Python, the system Ruby and aiohttp, which HTTP Toolkit read and whatleaks
    only named (D-31);
  - `node:http2`, which no other tool reads (D-32);
  - about 6 ms of proxy CPU per new TLS connection (D-33). The p50 per new connection
    went from 18.9 to 9.4 ms, now the lowest of the three proxies.
- **Harness fixes:** Debian curl hashing, the summary's scoring of the old build, the
  perf client under HTTP Toolkit.
- **Left as is:**
  - the remaining 27 misses need a kernel-level hook (D-04);
  - large uploads are slower than mitmproxy's because of a quadratic buffer in mockttp
    (D-33). The fix belongs upstream.

## Benchmark session (2026-10-21, afternoon)

The owner asked for real evals and benchmarks, and for the gaps they show to be fixed
(D-24). Results are in `docs/BENCHMARK.md`.
- **Lab, 564 attempts with exact ground truth:** silently missed 48 % → **6 %**
  (mitmproxy 35 %). At the best possible outcome: 41 % → **94 %** (mitmproxy 65 %).
- **Real tools:** whatleaks matched each tool's debug output.
  - Next.js on Node 20 and 22: 22 of 22.
  - Wrangler: 3 of 3.
  - Turborepo: the same 10 of 17 as before, and the other 7 never leave the process.
  - mitmproxy saw nothing from Next.js on Node 20 or from Turborepo. phonehome only
    named hosts.
- **Linux:** a `/proc` backend, checked in `node:22-slim`.
- **Fixed along the way:**
  - Java;
  - Node < 22.21;
  - app-made Node agents on new Node;
  - short direct connections and short-lived children;
  - late helpers;
  - WebSocket scanning;
  - large and abandoned uploads;
  - a report that took hours on a 1 MiB plain-text body (quadratic email regex);
  - a pipeline (`| tail`) that made runs wait 10 s;
  - 1 s of startup on machines with VPN interfaces;
  - the 12 findings of a second independent review.
- **Decided under the owner's "do what's best", reversible:**
  - D-25: the Node preload, which settles open question 5 below; `--no-node-preload`
    turns it off.
  - D-30: polling every 20 ms while the app is busy, which costs CPU.
- **Machine notes:** the disk ran full once, from a scratch Prisma install, since
  deleted. Wi-Fi dropped and the LAN address changed during runs. The bench runner now
  waits, reruns and resumes.

## Morning summary (2026-10-21)

**What it is.** The project is **whatleaks** (renamed from phonehome, D-03). It lives
in `sideproj/whatleaks`, with local git only: nothing published, no remote. Commands:
- `whatleaks run -- <cmd>` captures one run
- `compare -- <cmd>` runs it with defaults, then opted out, and diffs the two
- `report <har>` and `diff <a> <b>` analyse saved captures, including HAR from other
  tools
- `opt-outs` lists the opt-out variables `compare` sets

### What works (each item run for real)

- **Next.js 16.4.2, `next build`.**
  - whatleaks captured **22 of 22 telemetry events**, with identical per-name counts
    against `NEXT_TELEMETRY_DEBUG=1`.
  - **`DO_NOT_TRACK=1`: still 8 of 8 requests**. `anonymousId` and `projectId` stayed
    the same across runs, and `--strict` exited 1.
  - `NEXT_TELEMETRY_DISABLED=1` alone: 8 → 0.
  - All 32 opt-outs together: 8 → 0.
  - Every comparison was repeated, with the same result.
- **`next dev --duration`.** The shutdown event, which a detached helper sends after
  SIGTERM, is captured (204).
- **Turborepo 2.11.10.**
  - Telemetry was captured, and `DO_NOT_TRACK=1` stops it (1 → 0).
  - whatleaks saw 10 of the 17 events its debug log prints. The other 7 never leave
    the process: turbo exits about a second after the last batch is queued, before
    that batch's request starts (from turbo's source).
- **Clients that refuse the CA are named with a count:** Go 1.26.5, Apple
  `/usr/bin/python3`, and a pinned Node client.
- **Clients captured in full:** curl, Homebrew Python, and Node
  `fetch`/`http`/`https` (Node ≥ 22.21 or ≥ 24.5).
- **Packaging:**
  - The tarball works: `npm pack`, then install into an empty project (195 packages,
    41 MB), then `npx whatleaks`.
  - From source, `git clone && npm ci && npm run build` works.
  - whatleaks itself runs on Node 26.0.0, 22.23.3 and 22.19.0.
- **Safety:**
  - The proxy listens on loopback only, checked at runtime, not just by tests.
  - The CA is new for each run, and its key stays in memory.
  - Nothing is installed system-wide.
  - Upstream TLS is verified: a request to `self-signed.badssl.com` fails through
    whatleaks too.
  - HAR files are written atomically with mode 0600.
- **Redaction:** reports are shareable by default. Every leak the reviewer found is
  planted in `test/leaks.test.ts`, and none appears in any output format.

### Findings worth knowing (all in `docs/e2e/README.md`)

- **Next.js 16.4.2 telemetry fails silently on Node 24.22 and 26.0** with "Expected
  signal to be an instance of AbortSignal", with or without whatleaks. It works on
  Node 20 and 22. That is why the demo runs the child on Node 22.23.3 (D-22).
- **Next.js records which AI agent ran the build** (`meta.agentName:
  "claude-code_2-1-306_agent"`). Turborepo sends an `x-ai-agent` header.
- **Every `next build` POSTs `{"next":["16.4.2"]}`** to npm's security-advisory
  endpoint, even with all opt-outs set. It is not telemetry, but it is a phone-home
  that whatleaks shows under "other traffic".
- **consoledonottrack.com**, the `DO_NOT_TRACK` convention site, is now a dog-care
  blog.

### What doesn't work, or is untested

- **Benchmarked on macOS 26.6.2 (arm64) and on Linux in Docker (arm64).** Windows is
  untested.
- **Untested:** GUI and Electron apps, browsers, and forwarding through an existing
  corporate proxy (implemented, not tested).
- **Some helpers are missed.** A detached helper whose parent exits at once, that runs
  outside the app's folder, and that first connects more than `--grace` seconds
  (default 1 s) later, is not captured. In the app's folder it is waited for (lab:
  100 % up to 8 s).
- **Very short connections that bypass the proxy can be missed in programs with no
  hook** (Go, Rust, C). That means ones reset within ~10 ms, or UDP sent with
  `sendto()` (`docs/BENCHMARK.md` §3). From Node, Python and Ruby they are all
  reported.
- **Keyword guesses mislabel some APIs** (GitHub `/events`). They are marked `?` and
  never counted in headlines or `--strict`.
- **Imported HAR** was tested only with hand-made devtools-style and mitmproxy-style
  samples, not real Proxyman, Charles or HTTP Toolkit exports.

### Needs your decision

1. **Publishing.** The name `whatleaks` was free on npm and PyPI on 2026-10-21; re-check
   before publishing. Nothing has been published (hard rule).
2. **The `basic-ftp` audit finding reaches installed copies (D-19).** npm ignores our
   `overrides` for consumers. The path is unreachable in whatleaks, since it fetches
   PAC files over FTP and whatleaks never configures PAC. The recommendation is to
   accept it, document it, and ask mockttp upstream to bump `pac-proxy-agent`.
3. **Install size.** The first `npx` run pulls about 41 MB (mockttp). The alternative
   is a smaller hand-written proxy (D-08).
4. **The launch headline.** The verified, reproducible story is "`DO_NOT_TRACK=1`
   doesn't stop Next.js telemetry; here's the diff". Next.js documents this, so the
   framing should be "the opt-out you assumed isn't the one that works", not "Next.js
   lies". A broader "we audited N dev tools" post would need more real runs: each
   tool's run with its documented opt-out.
5. **Old Node — decided in the benchmark session (D-25), please confirm.** whatleaks
   now adds a `NODE_OPTIONS` preload by default. It lifted Node 20 from 0 to 100 % and
   app-made agents on new Node from 0 to 100 %. `--no-preload` turns it off, together
   with the Python and Ruby hooks (D-31).

### How to resume

```
cd ~/Downloads/sideproj/whatleaks
npm ci && ./scripts/gate.sh        # 242 tests, all offline
node dist/cli.js --help
```

The scratch apps used for the real runs are in `/tmp/wl-e2e/` (`next-app`,
`turbo-app`, the Node 22 and 24 binaries). `/tmp` may have been cleared since.
