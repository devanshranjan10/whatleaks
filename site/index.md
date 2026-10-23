---
title: "whatleaks: see what your tools send home"
url: https://whatleaks.me/
updated: 2026-10-23
---

# whatleaks

> whatleaks is an open-source CLI (npm package `whatleaks`, MIT) that runs a command through a local, single-run proxy and reports where its traffic went, how often, which fields each payload carried, and whether any of it is about you. `whatleaks compare` runs the command twice, with defaults and then opted out of telemetry, and shows what is still sent.

- Website: https://whatleaks.me/
- Source: https://github.com/devanshranjan10/whatleaks
- npm: https://www.npmjs.com/package/whatleaks (`npx whatleaks`)
- Author: Devansh Ranjan
- License: MIT
- Current version: 0.1.0 (2026-10-23)
- Platforms: macOS and Linux, Node ≥ 22.12

## What it does

- `whatleaks run -- <command>` captures one run and prints a report: where the traffic went, how often, which fields each payload carried (with redacted samples), and whether any of it is about you: your username, hostname, home path, MAC address (also as a hash), machine id or git email.
- `whatleaks compare -- <command>` runs the command twice in fresh processes, first with defaults and then opted out (all 32 documented opt-out variables, or only the ones you name with `--off-env`), and shows what is still sent. `--strict` exits 1 if a known telemetry endpoint is still contacted.
- `whatleaks report <file.har>` and `whatleaks diff <before.har> <after.har>` analyse captures, from whatleaks or another tool.
- `whatleaks opt-outs` lists the opt-out variables `compare` sets, with the tools each one covers.

## Example: Next.js and DO_NOT_TRACK

Real output from `next build` (Next.js 16.4.2, Node 22.23) on 2026-10-21:

```
$ npx whatleaks compare --no-known-opt-outs --off-env DO_NOT_TRACK=1 -- ./node_modules/.bin/next build

The telemetry endpoint was still contacted after opting out.
Telemetry requests: 8 → 8 · all requests: 9 → 9

STILL SENDING AFTER OPT-OUT
  ● POST telemetry.nextjs.org/api/v1/record  analytics · Next.js telemetry  8 → 8 requests
      still sent: context.anonymousId, context.projectId, context.sessionId, events[].eventName, meta.agentName, meta.ciName, meta.cpuCount, meta.cpuModel, meta.cpuSpeed, meta.isCI …+81

PERSISTENT IDENTIFIERS
  same value in both runs: stored by the app or built into it, so it can link runs together
  ○ ‹id-1› at context.anonymousId → POST telemetry.nextjs.org/api/v1/record
  ○ ‹id-2› at context.projectId → POST telemetry.nextjs.org/api/v1/record
```

`DO_NOT_TRACK=1` does not stop Next.js telemetry, and Next.js never says it does: its documented switch is `NEXT_TELEMETRY_DISABLED=1`, and with that set telemetry went from 8 requests to 0. Each request also carried the machine's OS, CPU model and memory, and the AI agent that ran the build (`meta.agentName`). Transcripts: https://github.com/devanshranjan10/whatleaks/tree/main/docs/e2e

## Measured

A lab with exact ground truth: 46 scenarios and 594 attempts on macOS, 43 and 567 on Linux. Attempts silently missed:

| Tool | macOS | Linux |
|---|---|---|
| whatleaks | 3.4 % (20 of 594) | 3.0 % (17 of 567) |
| mitmproxy 12.2.3, same environment | 38 % (225) | 40 % (225) |
| HTTP Toolkit server 1.27.3, its own interception | 67 % (399) | 70 % (399) |

- Every remaining miss is in a Go program, which whatleaks loads no hook into.
- Nothing the app did not send was ever credited to it.
- All 8 planted identifiers were found in every run; none of the 4 decoys was flagged.
- Real tools, checked against each tool's own debug output: whatleaks matched 5 of 5, HTTP Toolkit 4, mitmproxy 3.

Full method and every scenario: https://whatleaks.me/benchmark/

## How it works

1. A fresh certificate authority per run. Its key stays in memory; its certificate is written to a private temp folder deleted when the run ends. Nothing is installed in the system trust store.
2. A proxy on 127.0.0.1 only, given to the app through the standard proxy and CA environment variables, plus a Java truststore.
3. Small hooks for Node, Python and Ruby route clients that ignore proxy variables (`node:http2`, aiohttp, old Node, app-made agents) and report each direct socket as it opens.
4. The app's process tree is followed, including detached helpers, so late telemetry is waited for and everything stops on `--duration` or Ctrl-C.
5. Connections that bypass the proxy are listed by address and process: `netstat` on macOS, `/proc` on Linux.
6. Payloads are decoded (JSON, NDJSON, form, binary), every field is inventoried, and this machine's identifiers are searched for raw and as md5, sha1 and sha256. Endpoints are classified from a catalog of 69 known telemetry hosts. Reports are redacted for sharing.

## Limits

- Apps that refuse the CA (pinned clients, Go programs on macOS) are named and counted, not read. whatleaks does not try to get around pinning.
- Direct connections from Go, Rust or C are found by polling: one reset within about 10 ms is often missed, and UDP sent with `sendto()` is never seen.
- Windows has no process-watching backend and is untested.
- Only processes launched through whatleaks are watched; GUI apps, browsers and daemons were not tested.
- Identity matching is exact: salted hashes can't be recognised. Redaction is pattern-based.
- The benchmark is the author's own; scripts and result files are public.
