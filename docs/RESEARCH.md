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

## 5. Capture facts verified against official docs (agent run, 2026-10-21)

Each fact was checked against official docs, and most were also run on this Mac with
Node 26.0.0, Node 22.19.0, Apple curl 8.7.1, Python 3.14/3.13/Apple 3.9, Go 1.26.5
and Bun 1.3.11.

| Fact | Source | Consequence for whatleaks |
|---|---|---|
| `NODE_USE_ENV_PROXY=1` was added in v24.0.0 and v22.21.0. It covers `fetch`, plus `http`/`https` since 24.5.0 and 22.21.0. It reads `HTTP(S)_PROXY`/`NO_PROXY`, with lowercase taking precedence. Stability 1.1 (experimental). | nodejs.org/api/http.html#built-in-proxy-support, nodejs.org/api/cli.html#node_use_env_proxy1 | Set the env var and **never** put `--use-env-proxy` in `NODE_OPTIONS`: Node 22.19 refuses to start (exit 9). Node older than 22.21 ignores it, so its traffic goes direct and is caught by the direct watcher. |
| `NODE_EXTRA_CA_CERTS` *extends* the bundled roots and is read once at startup. `fetch` honours it (observed). | nodejs.org/api/cli.html#node_extra_ca_certsfile | Point it at `ca.pem` (just the CA). |
| `REQUESTS_CA_BUNDLE`, `CURL_CA_BUNDLE`, httpx/urllib `SSL_CERT_FILE` and Go on Linux all *replace* the default roots. | requests docs (advanced#proxies), python-httpx.org/environment_variables, curl.se/docs/manpage.html | Point them at `bundle.pem` (CA plus Node's root store), so any request that goes direct still verifies. |
| curl ignores uppercase `HTTP_PROXY`. Go and reqwest read uppercase first; Node, Python and curl prefer lowercase. | curl manpage, pkg.go.dev/net/http#ProxyFromEnvironment, nodejs docs | Set both cases to the same value. |
| Go on macOS ignores `SSL_CERT_FILE` (platform verifier since 1.18). reqwest 0.13 on macOS uses rustls-platform-verifier. | pkg.go.dev/crypto/x509#SystemCertPool, go.dev/doc/go1.18, reqwest 0.13.0 changelog | These apps refuse the CA. whatleaks reports them by SNI hostname as "not inspectable" (consistent with D-04). |
| Apple `/usr/bin/python3` (LibreSSL 2.8.3) ignored `SSL_CERT_FILE` (observed). Homebrew and python.org builds honour it. | observed | A limitation to document. |
| Deno: `HTTP(S)_PROXY`, `DENO_CERT`, and `NODE_EXTRA_CA_CERTS` in Deno 2.8+. Bun: `HTTP(S)_PROXY`, and `SSL_CERT_FILE` is additive. | docs.deno.com/runtime/reference/env_variables, bun.com/docs | Set `DENO_CERT=ca.pem`. Bun is covered by the existing variables. |
| mockttp's `server.url`/`proxyEnv` return `https://localhost:PORT` when HTTPS is configured, and clients then hang doing TLS to the proxy. | observed | Give the child `http://127.0.0.1:PORT`. |
| mockttp `tls-client-error` events carry no `destination`, only `tlsMetadata.sniHostname`. | observed | Name refused hosts by SNI. |
| HAR 1.2: `postData.text` and `params` are mutually exclusive, and `postData` has no `encoding` field. Custom fields must start with `_`. | softwareishard.com/blog/har-12-spec | Use `_encoding: "base64"` for binary request bodies (already in the types). |
| `lsof -F` output: `p` pid, `c` command, `f` fd, `t` type, `P` protocol, `n` `local->remote`, `T` `ST=…`. Without `-a`, selections are ORed. On macOS, users can see their own processes. | lsof.readthedocs.io (manpage, "Output for other programs") | `lsof -a -p <pids> -i -n -P -F pcPnT`. Linux availability is not guaranteed; fail soft. |
| Next.js: `NEXT_TELEMETRY_DISABLED=1` opts out. With `NEXT_TELEMETRY_DEBUG=1`, data "will **not be sent**" and is printed instead. | nextjs.org/telemetry | Ground truth needs a separate debug run. |

## 6. Telemetry catalogue (agent run, 2026-10-21)

The agent unpacked current npm and PyPI packages and read source and official docs.
None of the downloaded code was run. The full tables, with a URL per row, are encoded in
`src/catalog/hosts.ts` and `src/catalog/optouts.ts`.

**Findings that shape the product**

- **Next.js `next build` is the live demo.**
  - It sends through Node's global `fetch`, which `NODE_USE_ENV_PROXY` routes through
    whatleaks. It waits for `telemetry.flush()` before exiting.
  - `NEXT_TELEMETRY_DEBUG=1` prints events and **does not send them**, which gives
    ground truth.
  - Next.js does **not** honour `DO_NOT_TRACK`; `NEXT_TELEMETRY_DISABLED=1` stops it.
    This is documented behaviour, not a bug.
- **Astro** sends an *unsalted* SHA-256 of the project path when the project is not
  in git. This is why whatleaks matches the captured run's cwd, and its hashes, as
  `project-path` (D-16).
- **Homebrew** sends analytics from a detached `curl`, and the **.NET CLI** uploads on
  a *later* run. That is why whatleaks lingers for stragglers and why compare caveats
  exist.
- **Not visible by design:**
  - **Streamlit** sends from the browser tab, not the CLI process.
  - **Turborepo** was expected to refuse the CA on macOS, as a Rust binary using
    rustls-platform-verifier. **Corrected by the e2e run (docs/e2e §2):** Turborepo
    2.11.10 accepted the CA and its payload was fully readable, most likely through
    `SSL_CERT_FILE`, which rustls-native-certs reads.
- **Opt-outs and `DO_NOT_TRACK`:**
  - **Gradio** ignores `DO_NOT_TRACK`, although Hugging Face's docs say it covers
    Gradio. Seen in source, not run.
  - In the **GitHub CLI**, any `GH_TELEMETRY` value overrides `DO_NOT_TRACK`.
  - **consoledonottrack.com**, the original `DO_NOT_TRACK` convention site, now serves
    an unrelated dog-care blog (fetched 2026-10-21). The opt-out catalogue therefore
    cites tool docs instead.
