# Changelog

## Unreleased

- The README opens with a demo GIF, and whatleaks.me has a 55-second video. Both replay
  real output of 0.1.0 from npm, recorded on 2026-10-24 (`docs/e2e/README.md` §5).
- `SECURITY.md`, `CONTRIBUTING.md` and issue forms.

## 0.1.0 (2026-10-23)

First release.

- **`whatleaks run`** captures one run and prints a report. Each run also saves the raw
  capture as a HAR file that only you can read.
- **`whatleaks compare`** runs the command twice, first with defaults and then opted out
  of telemetry, and shows what is still sent. `--strict` exits 1 if a known telemetry
  endpoint is still contacted, for CI.
- **`whatleaks report`** and **`whatleaks diff`** analyse HAR files, from whatleaks or
  another tool.
- **Trust stays inside the app's process tree.** Each run makes a fresh CA and a proxy on
  `127.0.0.1` only. Nothing is installed in the system trust store, and no system proxy
  setting changes.
- **Hooks for Node, Python and Ruby** route clients that ignore proxy variables
  (`node:http2`, aiohttp), and report each direct TCP connection and UDP destination as
  it opens.
- **Connections that bypass the proxy** are listed by address and process, using
  `netstat` on macOS and `/proc` on Linux.
- **Reports are redacted for sharing.** `--raw` turns redaction off.
- **A catalog of 69 known telemetry hosts**, each with a source link, and 32 documented
  opt-out variables.

Measured in `docs/BENCHMARK.md`: in a lab with exact ground truth, whatleaks silently
missed 3.4 % of attempts on macOS and 3.0 % on Linux; mitmproxy 38 % and 40 %; HTTP
Toolkit 67 % and 70 %.
