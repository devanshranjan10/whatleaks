# Decisions

The owner pre-approved every brainstorming and planning gate and asked for decisions
to be recorded here instead of asked. Each entry can be reviewed and reversed.

Format: `D-NN — decision`, then why, and what would change it.

## Process

**D-01 — Architectural path.** New project with no existing flow to change. Full
path: research, spec, plan, milestones. The owner pre-approved the gates.

**D-02 — The writing-plans skill is not installed on this machine, so the plan was
written by hand.** Only `brainstorming` is installed. The plan follows the same
structure as the sibling project's plan (`sideproj/landmine`): one gate per
milestone, files, tests, verify and commit. Execution is inline, in this session.

**D-03 — Renamed from phonehome to `whatleaks`.** The owner said "get a new name".
- npm `phonehome` and `phone-home` are taken.
- GitHub `zyralab/phonehome` has the same name and nearly the same pitch.
- `whatleaks` was free on npm and PyPI on 2026-10-21. GitHub has only an empty
  `whatleaks.github.io` page.
- The name says the promise: `npx whatleaks -- <cmd>`.

## Scope and safety

**D-04 — The scope stays on auditing processes the user launches.** Trust in the
run's CA goes only to that process tree, through standard environment variables.
- No system trust-store changes, no system proxy changes, no app flags that disable
  certificate checks.
- No attempt to get around certificate pinning. A refusing app is reported by
  hostname and count.

Why: this is the method HTTP Toolkit and mitmproxy document for your own processes,
and it keeps whatleaks from becoming a general interception tool. It also makes the
honesty story simple: what we could not see is named in the report.

**D-05 — Ephemeral CA per run.** The private key never touches disk. The CA
certificate lives in a 0700 temp dir that is deleted when the run ends. Cost: about
100 ms of key generation per run. A persistent CA would be a stealable long-lived
trust anchor.

**D-06 — Reports are redacted by default, and HAR files are raw but written 0600.**
Reports are what people share, so local identifiers, secrets and emails are replaced
with labels. The HAR is the evidence and is needed for re-analysis. `--raw` turns
redaction off.

## Toolchain

**D-07 — Reuse the sibling project's proven versions.** commander ^15, tsup ^9,
vitest ^5, TypeScript ~6.0.3 (typescript-eslint 8.72 caps it below 6.1), eslint ^10,
and Node `>=22.12` (the floor that vitest 5 and commander 15 require). The dev
machine runs Node 26.0.0.

**D-08 — mockttp 4.6.4 for the proxy, forced onto loopback.** It was verified by a
spike (RESEARCH §4): Node fetch and https, curl and Python were captured, and a
refusing client was reported with its SNI hostname.
- Cost: 149 packages, 40 MB, which makes the first `npx` slow.
- A hand-written proxy would be smaller, but would also have to handle HTTP/2,
  WebSocket and CONNECT edge cases. That is the riskier choice for one session.
- mockttp's `start()` listens on every interface. whatleaks wraps
  `net.Server.prototype.listen` only while `start()` runs, so it binds `127.0.0.1`,
  and a test proves the proxy cannot be reached from other interfaces.
- Revisit if install size hurts adoption.

**D-09 — HAR 1.2 is the capture format.** It's a standard, so captures from browser
devtools, mitmproxy, Proxyman, Charles and HTTP Toolkit can be analysed too, and
fixtures are plain files. whatleaks-specific data lives in `_`-prefixed fields, as
the HAR spec allows custom fields.

## Product

**D-10 — `compare` runs the "on" capture first and the opted-out capture second.**
Both are fresh processes, so the restart is built in. That answers the top HN
criticism of the Trae writeup.
- Known bias: first-run-only events (install pings, notices) happen only in the
  first run. That makes "stopped" findings less reliable.
- "Still sending" findings are always direct observations from the second run, so
  the bias can only make whatleaks *under*-report leaks, never invent them.
- This is documented in ACCURACY.

**D-11 — Classification always shows its basis.** The basis is `catalog` (a host
listed with a source URL) or `heuristic` (path or host keywords). A heuristic never
appears as a fact in reports.

**D-12 — The child-environment list and the opt-out catalog come from verified
docs.** Every opt-out entry carries a source URL. Entries that could not be verified
are left out rather than guessed.

**D-13 — Override `basic-ftp` to `^6.2.3`.** `npm audit` reported 4 high-severity
findings. All trace to `basic-ftp@5.3.1` (GHSA-c475-qrg2-pj4r, a CPU DoS in FTP
directory-listing parsing), reached through mockttp → pac-proxy-agent → get-uri. That
FTP path is only used to fetch PAC files over `ftp://`, which whatleaks never
configures.
- The override clears the audit, and `get-uri` and `mockttp` still load.
- If a later get-uri breaks on basic-ftp 6, drop the override. The FTP path is
  unreachable in whatleaks.

**D-14 — Redacted reports also mask app-generated ids.** In the default (shareable)
report:
- local identifiers become labels such as `‹home›` or `‹sha256(mac)›`
- secret-named headers, fields and query params become `‹redacted›`
- other emails become `‹email›`
- every id-shaped value (UUID, long hex, opaque token) is masked to `0f8f…950e`

Why: an install id or anonymous id in a public report links the report to its
author's telemetry stream. The test suite caught this: the first build printed an
`authorization` header and an `anonymousId` in field examples. The mask keeps four
characters at each end, so the same id is still recognisable within one report.
`--raw` shows everything.

**D-15 — Identity matching includes hashes.** Each local identifier (username,
hostname, home, MAC, machine id, git email and name) is also matched as md5, sha1 and
sha256 hex, plus base64 for the longer ones. Telemetry SDKs commonly send
`sha256(MAC)` as a "machine id". Short or generic names (`root`, `admin`, anything
under 4 characters) are skipped to avoid noise. Matches are blanked as they are found,
so a username inside a matched home path counts once, as the home path.

**D-16 — The run's working directory is an identifier (`project-path`).** Astro's
telemetry sends an unsalted SHA-256 of the project path when the project is not a git
repo (research §6). That hash can be reversed by guessing likely paths. whatleaks
matches the captured run's cwd, its JSON-escaped and URL-encoded forms, and its
md5/sha1/sha256 hashes. The cwd is skipped when it is the home directory itself.

**D-17 — The catalogs carry sources and support path scopes.** The host catalog has
69 entries, and path-specific rules beat host-only ones. Hosts that also serve ordinary
content (storybook.js.org, huggingface.co, chatgpt.com) match only on their telemetry
path. The opt-out catalog has 32 environment variables, each with a source. Tools
whose only opt-out is a config file or a command (VS Code, Gemini CLI, Codex CLI,
Firebase CLI) are left out of `--opt-out`; the README tells users to do a manual
before/after with `whatleaks diff` for those.

**D-18 — The `--no-decrypt <host>` flag became `--passthrough <host>`.** Commander
parses any `--no-*` flag as a boolean negation, so it cannot take a value.
`--passthrough` matches mockttp's own term (`tlsPassthrough`). Tunnelled hosts are
counted and listed under "not visible".

**D-19 — The `basic-ftp` override does not reach installed copies; this needs an owner
decision before publishing.** npm applies `overrides` only in the root project. A
packed install (`npm install whatleaks-0.1.0.tgz`) pulls `basic-ftp@5.3.1`, and
`npm audit` there reports it. The vulnerable path is mockttp → pac-proxy-agent →
get-uri, which fetches PAC files over `ftp://`. whatleaks never configures a PAC file,
so the path is unreachable. Options before publishing:
- (a) accept it and document it
- (b) bundle mockttp into `dist/` (`noExternal`), which keeps the same code but hides
  it from audit, so this is not recommended
- (c) ask mockttp upstream to bump pac-proxy-agent

Recommendation: (a) now, (c) as a follow-up.

**D-20 — Warn when the `node` on PATH cannot use the proxy, instead of injecting a
preload.**
- Node earlier than 22.21, and 24.0–24.4 for `http`/`https`, ignores
  `NODE_USE_ENV_PROXY`.
- A `NODE_OPTIONS=--require` preload could patch the global dispatcher, which is how
  HTTP Toolkit does it. But it would edit the app's own `NODE_OPTIONS` and depend on
  Node internals.
- whatleaks instead checks `node --version` on the child's PATH, prints a warning, and
  adds a report note.

Revisit if many users run old Node.

**D-21 — Idle time after exit counts from the exit, and requests are recorded at
request-initiated.** Both came from real runs:
- `next dev` hands its last telemetry event to a detached helper on SIGTERM. The helper
  started 0.3 s after exit, after the old idle check (1 s since last activity) had
  already passed.
- Turborepo exits before its telemetry responses arrive.

A request is now kept from its headers, and marked if its body never completed.

**D-22 — The end-to-end demo uses Node 22.23.3 for the child.** Next.js 16.4.2's
telemetry throws inside the process on Node 24.22 and 26.0 (e2e §3), so nothing would
be sent. Node 22.21+ has both working Next telemetry and `NODE_USE_ENV_PROXY`. The
official binary was downloaded to `/tmp` and checksum-verified; nothing was installed
system-wide. whatleaks itself ran on the machine's Node 26.0.0.

**D-23 — An independent code review was acted on in full.** The review was read-only
and run by a separate agent after M8. It reported 20 findings and all 20 were fixed,
each with a test (commits ba283cc and f4060a2). Choices made along the way:
- **Ids become per-report aliases (`‹id-1›`), not partial masks.** This supersedes the
  masking part of D-14. A mask that keeps 8 characters of an install id still lets the
  vendor link a public report to its author. Aliases are shared between the two
  reports of a diff, so a persistent id keeps one alias.
- **Fingerprints are an HMAC with a random key per process.** A plain `sha256(value)`
  can be brute-forced when the value is itself a hash of a MAC or username.
- **Known versus guessed telemetry.** Headlines and `--strict` count only catalog
  hosts. URL keyword guesses go in a "possibly telemetry" section. This enforces D-11:
  a heuristic never counts as a fact.
- **`--strict` also fails when the second run did not exit cleanly.** A crash looks
  exactly like an opt-out that worked.
- **Signals.** A Ctrl-C while the app runs is the normal way to stop it, so the wait
  for late senders still happens. A signal before the app starts or after it exits
  ends the wait, stops leftover processes and still writes the HAR.
- **Process identity is pid plus start time.** Helpers are also adopted by their
  connection to the proxy, because macOS 26 hides other processes' environments even
  from their owner, which rules out an environment marker.
- **Memory.** mockttp's `recordTraffic` is turned off (it kept every body). Bodies over
  8 MiB are counted, not buffered, and decoding is capped at 16 MiB.

## Benchmark round (2026-10-21, afternoon)

**D-24 — Build a benchmark, then close the gaps it measures (option C).** The owner
asked to "run the evals and benchmarks and achieve SOTA … fix all the gaps", and,
offered four scopes, answered "do what's best … keep doing it until done … everything
should be real". Chosen: an offline lab with exact ground truth, a real-tool corpus,
and two real baselines (mitmproxy, zyralab/phonehome). Spec:
`docs/superpowers/specs/2026-10-21-whatleaks-bench-design.md`.
- The real-tool runs send those tools' real telemetry from this Mac, as M8 did.
- Baselines run from pinned sources: mitmproxy through `uvx` (no global install),
  phonehome at commit `946f42d`, read before it was run.
- Publishing stays out of scope.

**D-25 — Load a Node preload for old Node, superseding D-20.** D-20 chose a warning over
editing `NODE_OPTIONS` and said to revisit if old Node mattered. The benchmark made the
cost concrete: on Node 20 (still common after its April 2026 end of life) every `fetch`
and `https` request bypassed whatleaks and was at best named by address.
- `NODE_OPTIONS=--require dist/preload.cjs` (quoted, prepended, the user's options kept)
  plus `WHATLEAKS_PRELOAD=1`. The preload does nothing unless that variable is set, and
  nothing on Node versions that honour `NODE_USE_ENV_PROXY`.
- On old Node it patches `http.Agent`/`https.Agent` prototypes (so app-made agents are
  covered) and replaces undici's global dispatcher with an Agent whose connector opens a
  CONNECT tunnel. TLS stays inside the app against `NODE_EXTRA_CA_CERTS`, as with the
  built-in proxy support. Loopback hosts stay direct.
- Everything is wrapped so a failure leaves the app running as if whatleaks were not
  there. Newer undici keeps its Agent under `globalDispatcher.2`; both layouts are handled.
- `--no-node-preload` turns it off and restores the D-20 warning.
- Not covered: the `undici` package with its own dispatcher, `node:http2`, raw sockets.
  Those are caught only as direct connections.

**D-26 — Java through `JAVA_TOOL_OPTIONS` and an in-process JKS truststore.** The JVM
ignores proxy variables and `SSL_CERT_FILE`. `keytool` would start a JVM (about 0.2 s)
on every run, Java or not, so whatleaks writes the JKS file itself: a documented format
with a SHA-1 keyed digest, verified by `keytool -list`. User options come after ours so
theirs win. The JVM prints "Picked up JAVA_TOOL_OPTIONS" on stderr; that is visible but
harmless.

**D-27 — macOS direct watcher on `netstat -anvW`, every 100 ms, plus a closing sweep.**
`netstat` lists every socket with its pid in about 5 ms, against lsof's 500 ms sampling
of tracked pids. macOS keeps the last owner's pid on TIME_WAIT and FIN_WAIT sockets, so
a connection the app already closed is still attributed at the end of the run. A socket
from an unknown pid higher than the app's is looked up once (`ps -p`) while it is alive,
which catches short-lived children. lsof remains the backend on other platforms.

**D-28 — Linux backend on `/proc`, polled every 20 ms.** Slim containers and CI images
often have no `ps`, `lsof` or `netstat`, which left the process tree and the direct
watcher off. Everything they gave is in `/proc`: `<pid>/stat` for the tree,
`<pid>/cwd` for helper adoption, and `net/{tcp,tcp6,udp,udp6}` joined to the
`socket:[inode]` links in `<pid>/fd` for sockets. Linux drops the owner of a closed
socket (TIME_WAIT has inode 0), so there is no closing sweep as on macOS. Instead the
poll is cheap enough to run every 20 ms: the tables are re-read only when a process holds
an inode not seen before. Start times come from `/proc/uptime`, not `btime`; `btime` is
whole seconds and drifts after a VM sleeps, which rejected helpers as "started before
the run". Checked in `node:22-slim` (`bench/linux/check.mjs`): a 10 ms raw TCP connection
was named in 20 of 20 runs.

**D-29 — Agents the app makes itself get `proxyEnv` by default.** `NODE_USE_ENV_PROXY`
covers only Node's global agents. An app that creates its own `http.Agent` or
`https.Agent` (keep-alive agents, many axios and got setups) bypassed whatleaks entirely
on Node 22.21+ and 24.5+. In a check, 3 of 4 requests went direct. The preload
replaces `http.Agent` and `https.Agent` with a plain-function wrapper that adds
`proxyEnv: process.env` unless the app passed its own. The wrapper shares the original
prototype, so `instanceof`, `class extends` and old-style `Agent.call(this)` subclasses
all keep working. An app's explicit `proxyEnv` wins. Not covered: the `undici` package's own
dispatchers.

**D-30 — Socket polling adapts to activity.** Connections that are reset, or that the
server closes, leave no TIME_WAIT, so only a live poll sees them. Polling runs every
20 ms while the app is busy (its first 3 s, and 3 s after any new socket or process of
its own), and every 100 ms otherwise. The process tree is listed every 100 ms while busy
and every 500 ms otherwise. UDP is read on every 2nd poll; every 4th missed most
one-datagram sockets in the lab (30 %). Measured on the dev Mac:
- a 20 s run costs 5.6 s of CPU (6.4 s for the build before the benchmark work);
- resets after 50 ms or more were all caught;
- resets after 10 ms were caught in 1 of 10 runs, which is the floor of sampling.

**D-31 — Python and Ruby hooks, and one `--no-preload` flag.** The HTTP Toolkit baseline
read three clients whatleaks could only name:
- Apple's `/usr/bin/python3` and the macOS system Ruby, which ignore `SSL_CERT_FILE`;
- aiohttp, which ignores proxy variables unless a session has `trust_env=True`.

whatleaks now loads a hook into each runtime, written from scratch rather than adapted
from HTTP Toolkit's AGPL code, and scoped to the app's process tree as the Node preload
is (D-25):
- **Python** (`PYTHONPATH`): a `sitecustomize.py`. It chains to any `sitecustomize` it
  shadows. When `ssl` or aiohttp is first imported, it patches it:
  - default contexts also trust the run's CA;
  - aiohttp's `trust_env` defaults to True.
- **Ruby** (`RUBYOPT=-rwhatleaks_hook`): adds the run's CA to OpenSSL's default
  certificate store and to `Store#set_default_paths`.

What stays untouched:
- Contexts given their own `cafile`, `capath` or `cadata`, and Ruby clients given their
  own `ca_file` or `cert_store`, keep their pinning (D-04).
- An explicit `trust_env=False` is kept.
- Nothing system-wide changes.

`--no-node-preload` becomes `--no-preload` and turns all three hooks off. Nothing had
been published, so no alias is kept.
