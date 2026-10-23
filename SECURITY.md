# Security

## Reporting a vulnerability

Please report vulnerabilities privately, through the repository's GitHub "Report a
vulnerability" form (Security → Advisories), not in a public issue. You'll get an answer
within a week.

## What whatleaks does, and where the risks are

whatleaks decrypts the HTTPS traffic of a command you run, so it handles that command's
secrets. This is what it does with them.

- **A certificate authority for one run.**
  - Each run generates a fresh CA. Its private key stays in memory and is never written.
  - The CA certificate (and a bundle and a Java truststore built from it) is written to
    a private temp folder, with files readable only by you, and deleted when the run
    ends.
  - Trust reaches only the app's own process tree, through environment variables.
    Nothing is added to the system trust store, and no system proxy settings change.
- **The proxy listens on 127.0.0.1 only.** mockttp would listen on every interface by
  default; whatleaks forces loopback, and a test checks it.
- **Traffic is forwarded, not changed.** The app's requests go where they would have
  gone anyway. Hosts given with `--passthrough` are tunnelled without being decrypted.
  whatleaks never tries to get around certificate pinning: an app that refuses the CA
  has that connection fail, and whatleaks lists the host.
- **Captures hold raw traffic.** Each run saves a HAR file, readable only by you, with
  everything the app sent, tokens included. It is never redacted. Share a report, not
  the HAR.
- **Reports are redacted by pattern.** Local identifiers, secret-looking headers and
  fields, emails and id-shaped values are replaced by labels and aliases. Patterns can
  miss things: read a report before you post it. `--raw` turns redaction off; raw
  reports are written readable only by you.
- **Local identifiers stay in memory.** Your username, hostname, home path, MAC
  address, machine id and git email are read to search the payloads and are never
  written to disk or sent anywhere.
- **No network of its own.** whatleaks has no account, no telemetry and no update
  check.
- **Processes.** whatleaks starts the command you give it, with extra environment
  variables (proxy settings, CA paths, and preloads through `NODE_OPTIONS`,
  `PYTHONPATH`, `RUBYOPT` and `JAVA_TOOL_OPTIONS`; `--no-preload` turns the preloads
  off). It signals only processes it tracked for that run, identified by pid and start
  time: the app's tree and processes that connected to its proxy.
