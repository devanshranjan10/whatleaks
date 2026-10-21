# Lab benchmark: whatleaks before and after, and mitmproxy

| | attempts | payload | request | host only | **silently missed** | at best possible |
|---|---|---|---|---|---|---|
| whatleaks before | 546 | 34 % | 12 % | 8 % | **47 %** (255) | 42 % |
| whatleaks after | 546 | 66 % | 1 % | 25 % | **8 %** (42) | 92 % |
| mitmproxy | 546 | 62 % | 0 % | 5 % | **32 %** (177) | 68 % |

"At best possible": share of attempts that reached the best outcome a tool can reach without breaking its rules (payload for proxy-aware clients; the destination named for pinned clients and clients that ignore proxies).

| Scenario | Best possible | whatleaks before | whatleaks after | mitmproxy |
|---|---|---|---|---|
| Node 26 fetch | payload | 100 % | **100 %** | 100 % |
| Node 26 https.request | payload | 100 % | **100 %** | 100 % |
| Node 26 gzip, brotli, zstd bodies | payload | 100 % | **100 %** | 100 % |
| Node 22.23 fetch | payload | 100 % | **100 %** | 100 % |
| Node 22.23 https.request | payload | 100 % | **100 %** | 100 % |
| Node 20 fetch (ignores NODE_USE_ENV_PROXY) | payload | 0 % | **100 %** | 0 % |
| Node 20 https.request (ignores NODE_USE_ENV_PROXY) | payload | 0 % | **100 %** | 0 % |
| Bun fetch | payload | 100 % | **100 %** | 100 % |
| curl (macOS) | payload | 100 % | **100 %** | 100 % |
| curl --http2 | payload | 100 % | **100 %** | 100 % |
| Python 3.14 urllib (Homebrew) | payload | 100 % | **100 %** | 100 % |
| Python requests | payload | 100 % | **100 %** | 100 % |
| Python httpx | payload | 100 % | **100 %** | 100 % |
| Apple /usr/bin/python3 urllib (LibreSSL) | host | 100 % | **100 %** | 100 % |
| Ruby 2.6 Net::HTTP (macOS system) | host | 100 % | **100 %** | 100 % |
| Go 1.26 net/http | host | 100 % | **100 %** | 100 % |
| Java 25 HttpClient | payload | 0 % | **100 %** | 0 % |
| Node WebSocket, 2 messages | payload | 100 % | **100 %** | 100 % |
| Node WebSocket, 20 messages | payload | 15 % | **100 %** | 100 % |
| 9 MiB upload | request | 100 % | **100 %** | 100 % |
| client pinning its own trust store | host | 100 % | **100 %** | 100 % |
| Node http2 module | host | 0 % | **60 %** | 0 % |
| Python aiohttp (trust_env=False) | host | 0 % | **80 %** | 0 % |
| raw TCP held 10 ms | host | 0 % | **100 %** | 0 % |
| raw TCP held 100 ms | host | 0 % | **100 %** | 0 % |
| raw TCP held 500 ms | host | 20 % | **100 %** | 0 % |
| raw TCP held 2 s | host | 100 % | **100 %** | 0 % |
| raw TCP reset by the client after 10 ms | host | 0 % | **30 %** | 0 % |
| raw TCP reset by the client after 50 ms | host | 0 % | **80 %** | 0 % |
| raw TCP reset by the client after 200 ms | host | 0 % | **100 %** | 0 % |
| raw TCP, server closes at once (client socket lives ~1 ms, no TIME_WAIT) | host | 0 % | **40 %** | 0 % |
| one UDP datagram, connected socket (like QUIC) | host | 0 % | **30 %** | 0 % |
| one UDP datagram, unconnected socket (sendto) | host | 0 % | **0 %** | 0 % |
| detached helper sends 0.2 s after the app exits | payload | 100 % | **100 %** | 100 % |
| detached helper sends 1.5 s after the app exits | payload | 0 % | **100 %** | 100 % |
| detached helper sends 3 s after the app exits | payload | 0 % | **100 %** | 100 % |
| detached helper sends 8 s after the app exits | payload | 0 % | **100 %** | 100 % |
| grandchild sends after its parent exited | payload | 100 % | **100 %** | 100 % |
| child process lives ~100 ms and connects directly | host | 0 % | **100 %** | 0 % |
| body with this machine’s identifiers and decoys | payload | 100 % | **100 %** | 100 % |
| identifiers in the 5th of 6 WebSocket messages | payload | 50 % | **100 %** | 100 % |
