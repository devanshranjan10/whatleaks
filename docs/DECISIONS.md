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
