# Research

All facts checked on 2026-10-21. Where a fact came from running something on this
machine (macOS 26.6.2 arm64, Node 26.0.0), it says so.

## 1. Precedent

- **Trae IDE telemetry writeup.** HN item 44703164, 954 points, 366 comments,
  2025-07-27. Article: github.com/segmentationf4u1t/trae_telemetry_research.
  Method: Fiddler Everywhere plus System Informer on Windows. The author turned
  telemetry off in the settings UI and recorded again.
  - Findings: two ByteDance endpoints, about 500 calls in about 7 minutes, and a
    53,606-byte batch. user_id, device_id, machine_id and the window title kept
    being sent with telemetry off.
  - The top comment attacked the *method*: the author did not restart after
    changing the setting. **Lesson: the on-versus-off comparison must be scripted,
    use fresh processes, and be repeatable.**
- Other telemetry exposés on HN that used a hand-run proxy:
  - "Everyone knows your location", 1957 points: Charles, comparing tracking allowed
    against denied.
  - Wacom, 1594 points: Burp.
  - Yosemite phone-home corpus, 331 points: published as two datasets, defaults
    versus all sharing off.
  - "Claude Code sends 33k tokens", 706 points, 2026-07-12: a custom logging proxy.

## 2. Existing tools (none produce a per-app report with an on/off diff)

| Tool | Why it is not this |
|---|---|
| HTTP Toolkit (AGPL) | Interactive inspector; no report, no run diff |
| mitmproxy (MIT) | General interception; reports only if you script them |
| Proxyman, Charles, Fiddler | Closed-source GUI inspectors; diff of two single requests at most |
| LuLu, Little Snitch, OpenSnitch, Portmaster | Firewalls; destinations only, no payloads |
| PCAPdroid, TrackerControl | Android only |
| tokentap, claude-trace | LLM API traffic of one tool only |
| fix-macosx/net-monitor | Closest idea; abandoned in 2014 |
| zyralab/phonehome | lsof/nettop destinations-only HTML report; no payloads, no diff |

## 3. Naming

- `phonehome` and `phone-home` are taken on npm. A GitHub repo with the same name and
  pitch also exists (zyralab/phonehome).
- **`whatleaks`**: npm 404 (free), PyPI 404 (free). GitHub has only an empty
  `whatleaks/whatleaks.github.io`. Checked on 2026-10-21.

## 4. Capture spike (throwaway; ran on this machine)

mockttp 4.6.4 (Apache-2.0, `engines.node >=20`, CommonJS). Install footprint: 149
packages, 40 MB.

Setup: an ephemeral CA from `generateCACertificate()`, then
`forAnyRequest().thenPassThrough()`. The child got only these environment variables:
`HTTP(S)_PROXY`, `NODE_USE_ENV_PROXY=1`, `NODE_EXTRA_CA_CERTS`, `CURL_CA_BUNDLE`,
`SSL_CERT_FILE` and `REQUESTS_CA_BUNDLE`.

| Client | Result |
|---|---|
| Node 26 `fetch` (POST JSON) | captured, with the request body |
| Node 26 `https.get` | captured |
| macOS `/usr/bin/curl` | captured |
| Python 3 `urllib` | captured |
| curl with `--cacert` pointing at the system bundle only | refused; mockttp emitted `tls-client-error`, `failureCause: "cert-rejected"`, `sniHostname: "example.org"` |

So a client that will not trust the run's CA is still *named* in the report, with a
count, even though its payload is not visible.

**mockttp API facts used** (read from its 4.6.4 `.d.ts` files):

- Events: `request`, `response`, `abort`, `tls-client-error` (with
  `tlsMetadata.sniHostname` and `failureCause`), `tls-passthrough-opened`,
  `websocket-request`, `websocket-message-sent`, `client-error`.
- `CompletedBody.getDecodedBuffer()` removes the content-encoding.
- `https.tlsPassthrough: [{hostname}]` tunnels hosts without decrypting them.
- `thenPassThrough({ additionalTrustedCAs, simulateConnectionErrors })`.

**Safety issue found:** `MockttpServer.start()` calls `this.server.listen(port)` with
no host, so the proxy would listen on every interface. whatleaks must force
`127.0.0.1` (see D-08).
