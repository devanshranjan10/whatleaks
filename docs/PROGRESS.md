# Progress

This is the resume point for any session.

Spec: `docs/superpowers/specs/2026-10-21-whatleaks-design.md`.
Plan: `docs/superpowers/plans/2026-10-21-whatleaks.md`.
Decisions: `docs/DECISIONS.md` (D-01 to D-23). Research: `docs/RESEARCH.md`.
Accuracy: `docs/ACCURACY.md`. Real runs: `docs/e2e/README.md`.

## Status

Every milestone is done and committed: M0–M9, plus fixes from the real runs and from an
independent code review.

| Milestone | Commit |
|---|---|
| Research, spec, plan | fd12eee |
| M0 scaffold | 7301b37 |
| M1 HAR model, body decoding, URL templates | f47a67e |
| M2 analysis: fields, identity, classify, redact, report | 9f9727b |
| M3 renderers and `report` | a438b69 |
| Catalogs: 69 hosts, 32 opt-outs, all sourced | 7d5a82b |
| M4 diff and `diff --strict` | be6f148 |
| M5 capture core and `run` | 02446d0 |
| M6 process tree, linger, direct watcher | 497cc4f |
| M7 `compare` and `opt-outs` | fc9c14c |
| Fixes found by real runs | b2960bc, 953c87c, 4cdb839 |
| M8 real e2e, recorded fixtures, accuracy | ec0972f |
| M9 README and docs | ab14818, fb0eacf, 9441ec7 |
| Independent review: 20 findings fixed | ba283cc, f4060a2 |

**Gate on the last commit:** `npm ci`, typecheck, lint, **168 offline tests**, build. It
passes on a fresh `git clone`. Run `./scripts/gate.sh` before committing. It returns
npm's real exit code; an earlier `| grep` pipe hid two lint failures, which were
amended.

---

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

- **Tested only on macOS 26.6.2 (arm64).** Linux and Windows are untested.
- **Untested:** GUI and Electron apps, browsers, WebSockets, HTTP/2-only clients,
  HTTP/3, and forwarding through an existing corporate proxy (implemented, not
  tested).
- **Some helpers are missed.** A detached helper whose parent exits at once, and which
  first connects more than `--grace` seconds (default 1 s) later, is not captured.
- **Old Node bypasses the proxy.** Node older than 22.21 (and 24.0–24.4 for
  `http`/`https`) ignores the proxy. whatleaks warns, but the requests bypass it and
  are caught only if the 0.5 s `lsof` sampler sees them. On Node 22.19, a short
  `fetch` was missed.
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
5. **Old Node.** Should whatleaks inject a `NODE_OPTIONS` preload for Node older than
   22.21 (D-20)? That widens coverage, but it edits the app's own `NODE_OPTIONS`.

### How to resume

```
cd ~/Downloads/sideproj/whatleaks
npm ci && ./scripts/gate.sh        # 168 tests, all offline
node dist/cli.js --help
```

The scratch apps used for the real runs are in `/tmp/wl-e2e/` (`next-app`,
`turbo-app`, the Node 22 and 24 binaries). `/tmp` may have been cleared since.
