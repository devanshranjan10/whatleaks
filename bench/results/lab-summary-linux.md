# Lab benchmark (linux): whatleaks, mitmproxy, HTTP Toolkit

| | attempts | payload | request | host only | **silently missed** | at best possible |
|---|---|---|---|---|---|---|
| whatleaks | 567 | 74 % | 1 % | 22 % | **3 %** (17) | 97 % |
| mitmproxy | 567 | 60 % | 0 % | 1 % | **40 %** (225) | 60 % |
| HTTP Toolkit | 567 | 29 % | 0 % | 1 % | **70 %** (399) | 30 % |

"At best possible": share of attempts that reached the best outcome whatleaks can reach without breaking its rules (payload for proxy-aware clients; the destination named for pinned clients and clients that ignore proxies). A baseline can go beyond it (keep a body whatleaks cuts off, or read a client whatleaks can only name); those cases are listed below the table.

| Scenario | Best possible | whatleaks | mitmproxy | HTTP Toolkit |
|---|---|---|---|---|
| Node 26 fetch | payload | **100 %** | 100 % | 0 % |
| Node 26 https.request | payload | **100 %** | 100 % | 100 % |
| Node 26 https.request with its own keep-alive Agent | payload | **100 %** | 0 % | 100 % |
| Node 22.23 https.request with its own keep-alive Agent | payload | **100 %** | 0 % | 100 % |
| Node 26 gzip, brotli, zstd bodies | payload | **100 %** | 100 % | 100 % |
| Node 22.23 fetch | payload | **100 %** | 100 % | 100 % |
| Node 22.23 https.request | payload | **100 %** | 100 % | 100 % |
| Node 20 fetch (ignores NODE_USE_ENV_PROXY) | payload | **100 %** | 0 % | 100 % |
| Node 20 https.request (ignores NODE_USE_ENV_PROXY) | payload | **100 %** | 0 % | 100 % |
| curl (Debian) | payload | **100 %** | 100 % | 100 % |
| curl --http2 | payload | **100 %** | 100 % | 100 % |
| Python urllib (Debian, OpenSSL) | payload | **100 %** | 100 % | 100 % |
| Python requests | payload | **100 %** | 100 % | 100 % |
| Python httpx | payload | **100 %** | 100 % | 100 % |
| Go 1.26 net/http | payload | **100 %** | 100 % | 100 % |
| Java 17 HttpClient (OpenJDK) | payload | **100 %** | 0 % | 100 % |
| Node WebSocket, 2 messages | payload | **100 %** | 100 % | 0 % |
| Node WebSocket, 20 messages | payload | **100 %** | 100 % | 0 % |
| 9 MiB upload | request | **100 %** | 100 % | 0 % |
| client pinning its own trust store | host | **100 %** | 100 % | 100 % |
| Node http2 module (ignores proxy variables) | payload | **100 %** | 0 % | 0 % |
| Python aiohttp (ignores proxy variables by default) | payload | **100 %** | 0 % | 100 % |
| raw TCP held 10 ms | host | **100 %** | 0 % | 0 % |
| raw TCP held 100 ms | host | **100 %** | 0 % | 0 % |
| raw TCP held 500 ms | host | **100 %** | 0 % | 0 % |
| raw TCP held 2 s | host | **100 %** | 0 % | 0 % |
| raw TCP reset by the client after 10 ms | host | **100 %** | 0 % | 0 % |
| raw TCP reset by the client after 50 ms | host | **100 %** | 0 % | 0 % |
| raw TCP reset by the client after 200 ms | host | **100 %** | 0 % | 0 % |
| raw TCP, server closes at once (client socket lives ~1 ms, no TIME_WAIT) | host | **100 %** | 0 % | 0 % |
| one UDP datagram, connected socket (like QUIC) | host | **100 %** | 0 % | 0 % |
| one UDP datagram, unconnected socket (sendto) | host | **100 %** | 0 % | 0 % |
| Go raw TCP reset after 10 ms (no runtime hook) | host | **30 %** | 0 % | 0 % |
| Go raw TCP, server closes at once (no runtime hook) | host | **100 %** | 0 % | 0 % |
| Go UDP datagram, unconnected socket (no runtime hook) | host | **0 %** | 0 % | 0 % |
| detached helper sends 0.2 s after the app exits | payload | **100 %** | 100 % | 0 % |
| detached helper sends 1.5 s after the app exits | payload | **100 %** | 100 % | 0 % |
| detached helper sends 3 s after the app exits | payload | **100 %** | 100 % | 0 % |
| detached helper sends 8 s after the app exits | payload | **100 %** | 100 % | 0 % |
| grandchild sends after its parent exited | payload | **100 %** | 100 % | 0 % |
| child process lives ~100 ms and connects directly | host | **100 %** | 0 % | 0 % |
| body with this machine’s identifiers and decoys | payload | **100 %** | 100 % | 0 % |
| identifiers in the 5th of 6 WebSocket messages | payload | **100 %** | 100 % | 0 % |

Beyond the best possible outcome:
- mitmproxy read 3 of 3 payloads in "9 MiB upload" (whatleaks 0)

Not in the totals (not measured in every column, or skipped on this platform): bun-fetch, py-apple, ruby-system.
