# Lab benchmark: after

Run 2026-10-21T11:44:16.656Z on Darwin 25.6.0 arm64, 8 CPUs. whatleaks 0.1.0 (/tmp/wlb/after/dist/cli.js); mitmproxy Mitmproxy: 12.2.3.

## whatleaks

Attempts 546: payload 66 %, request 1 %, host only 25 %, **silently missed 8 %** (42).

| Scenario | Best possible | Attempts | payload | request | host | missed | at best (95 % CI) | unexpected |
|---|---|---|---|---|---|---|---|---|
| Node 26 fetch | payload | 9 | 9 | 0 | 0 | 0 | 100 % (70–100) | – |
| Node 26 https.request | payload | 9 | 9 | 0 | 0 | 0 | 100 % (70–100) | – |
| Node 26 gzip, brotli, zstd bodies | payload | 9 | 9 | 0 | 0 | 0 | 100 % (70–100) | – |
| Node 22.23 fetch | payload | 9 | 9 | 0 | 0 | 0 | 100 % (70–100) | – |
| Node 22.23 https.request | payload | 9 | 9 | 0 | 0 | 0 | 100 % (70–100) | – |
| Node 20 fetch (ignores NODE_USE_ENV_PROXY) | payload | 9 | 9 | 0 | 0 | 0 | 100 % (70–100) | – |
| Node 20 https.request (ignores NODE_USE_ENV_PROXY) | payload | 9 | 9 | 0 | 0 | 0 | 100 % (70–100) | – |
| Bun fetch | payload | 9 | 9 | 0 | 0 | 0 | 100 % (70–100) | – |
| curl (macOS) | payload | 9 | 9 | 0 | 0 | 0 | 100 % (70–100) | – |
| curl --http2 | payload | 9 | 9 | 0 | 0 | 0 | 100 % (70–100) | – |
| Python 3.14 urllib (Homebrew) | payload | 9 | 9 | 0 | 0 | 0 | 100 % (70–100) | – |
| Python requests | payload | 9 | 9 | 0 | 0 | 0 | 100 % (70–100) | – |
| Python httpx | payload | 9 | 9 | 0 | 0 | 0 | 100 % (70–100) | – |
| Apple /usr/bin/python3 urllib (LibreSSL) | host | 9 | 0 | 0 | 9 | 0 | 100 % (70–100) | – |
| Ruby 2.6 Net::HTTP (macOS system) | host | 9 | 0 | 0 | 9 | 0 | 100 % (70–100) | – |
| Go 1.26 net/http | host | 9 | 0 | 0 | 9 | 0 | 100 % (70–100) | – |
| Java 25 HttpClient | payload | 9 | 9 | 0 | 0 | 0 | 100 % (70–100) | – |
| Node WebSocket, 2 messages | payload | 6 | 6 | 0 | 0 | 0 | 100 % (61–100) | – |
| Node WebSocket, 20 messages | payload | 60 | 60 | 0 | 0 | 0 | 100 % (94–100) | – |
| 9 MiB upload | request | 3 | 0 | 3 | 0 | 0 | 100 % (44–100) | – |
| client pinning its own trust store | host | 3 | 0 | 0 | 3 | 0 | 100 % (44–100) | – |
| Node http2 module | host | 10 | 0 | 0 | 6 | 4 | 60 % (31–83) | – |
| Python aiohttp (trust_env=False) | host | 30 | 0 | 0 | 24 | 6 | 80 % (63–90) | – |
| raw TCP held 10 ms | host | 10 | 0 | 0 | 10 | 0 | 100 % (72–100) | – |
| raw TCP held 100 ms | host | 10 | 0 | 0 | 10 | 0 | 100 % (72–100) | – |
| raw TCP held 500 ms | host | 10 | 0 | 0 | 10 | 0 | 100 % (72–100) | – |
| raw TCP held 2 s | host | 10 | 0 | 0 | 10 | 0 | 100 % (72–100) | – |
| raw TCP reset by the client after 10 ms | host | 10 | 0 | 0 | 3 | 7 | 30 % (11–60) | – |
| raw TCP reset by the client after 50 ms | host | 10 | 0 | 0 | 8 | 2 | 80 % (49–94) | – |
| raw TCP reset by the client after 200 ms | host | 10 | 0 | 0 | 10 | 0 | 100 % (72–100) | – |
| raw TCP, server closes at once (client socket lives ~1 ms, no TIME_WAIT) | host | 10 | 0 | 0 | 4 | 6 | 40 % (17–69) | – |
| one UDP datagram, connected socket (like QUIC) | host | 10 | 0 | 0 | 3 | 7 | 30 % (11–60) | – |
| one UDP datagram, unconnected socket (sendto) | host | 10 | 0 | 0 | 0 | 10 | 0 % (0–28) | – |
| detached helper sends 0.2 s after the app exits | payload | 30 | 30 | 0 | 0 | 0 | 100 % (89–100) | – |
| detached helper sends 1.5 s after the app exits | payload | 30 | 30 | 0 | 0 | 0 | 100 % (89–100) | – |
| detached helper sends 3 s after the app exits | payload | 30 | 30 | 0 | 0 | 0 | 100 % (89–100) | – |
| detached helper sends 8 s after the app exits | payload | 30 | 30 | 0 | 0 | 0 | 100 % (89–100) | – |
| grandchild sends after its parent exited | payload | 30 | 30 | 0 | 0 | 0 | 100 % (89–100) | – |
| child process lives ~100 ms and connects directly | host | 10 | 0 | 0 | 10 | 0 | 100 % (72–100) | – |
| body with this machine’s identifiers and decoys | payload | 3 | 3 | 0 | 0 | 0 | 100 % (44–100) | – |
| identifiers in the 5th of 6 WebSocket messages | payload | 18 | 18 | 0 | 0 | 0 | 100 % (82–100) | – |

## mitmproxy

Attempts 546: payload 62 %, request 0 %, host only 5 %, **silently missed 32 %** (177).

| Scenario | Best possible | Attempts | payload | request | host | missed | at best (95 % CI) | unexpected |
|---|---|---|---|---|---|---|---|---|
| Node 26 fetch | payload | 9 | 9 | 0 | 0 | 0 | 100 % (70–100) | – |
| Node 26 https.request | payload | 9 | 9 | 0 | 0 | 0 | 100 % (70–100) | – |
| Node 26 gzip, brotli, zstd bodies | payload | 9 | 9 | 0 | 0 | 0 | 100 % (70–100) | – |
| Node 22.23 fetch | payload | 9 | 9 | 0 | 0 | 0 | 100 % (70–100) | – |
| Node 22.23 https.request | payload | 9 | 9 | 0 | 0 | 0 | 100 % (70–100) | – |
| Node 20 fetch (ignores NODE_USE_ENV_PROXY) | payload | 9 | 0 | 0 | 0 | 9 | 0 % (0–30) | – |
| Node 20 https.request (ignores NODE_USE_ENV_PROXY) | payload | 9 | 0 | 0 | 0 | 9 | 0 % (0–30) | – |
| Bun fetch | payload | 9 | 9 | 0 | 0 | 0 | 100 % (70–100) | – |
| curl (macOS) | payload | 9 | 9 | 0 | 0 | 0 | 100 % (70–100) | – |
| curl --http2 | payload | 9 | 9 | 0 | 0 | 0 | 100 % (70–100) | – |
| Python 3.14 urllib (Homebrew) | payload | 9 | 9 | 0 | 0 | 0 | 100 % (70–100) | – |
| Python requests | payload | 9 | 9 | 0 | 0 | 0 | 100 % (70–100) | – |
| Python httpx | payload | 9 | 9 | 0 | 0 | 0 | 100 % (70–100) | – |
| Apple /usr/bin/python3 urllib (LibreSSL) | host | 9 | 0 | 0 | 9 | 0 | 100 % (70–100) | – |
| Ruby 2.6 Net::HTTP (macOS system) | host | 9 | 0 | 0 | 9 | 0 | 100 % (70–100) | – |
| Go 1.26 net/http | host | 9 | 0 | 0 | 9 | 0 | 100 % (70–100) | – |
| Java 25 HttpClient | payload | 9 | 0 | 0 | 0 | 9 | 0 % (0–30) | – |
| Node WebSocket, 2 messages | payload | 6 | 6 | 0 | 0 | 0 | 100 % (61–100) | – |
| Node WebSocket, 20 messages | payload | 60 | 60 | 0 | 0 | 0 | 100 % (94–100) | – |
| 9 MiB upload | request | 3 | 3 | 0 | 0 | 0 | 100 % (44–100) | – |
| client pinning its own trust store | host | 3 | 0 | 0 | 3 | 0 | 100 % (44–100) | – |
| Node http2 module | host | 10 | 0 | 0 | 0 | 10 | 0 % (0–28) | – |
| Python aiohttp (trust_env=False) | host | 30 | 0 | 0 | 0 | 30 | 0 % (0–11) | – |
| raw TCP held 10 ms | host | 10 | 0 | 0 | 0 | 10 | 0 % (0–28) | – |
| raw TCP held 100 ms | host | 10 | 0 | 0 | 0 | 10 | 0 % (0–28) | – |
| raw TCP held 500 ms | host | 10 | 0 | 0 | 0 | 10 | 0 % (0–28) | – |
| raw TCP held 2 s | host | 10 | 0 | 0 | 0 | 10 | 0 % (0–28) | – |
| raw TCP reset by the client after 10 ms | host | 10 | 0 | 0 | 0 | 10 | 0 % (0–28) | – |
| raw TCP reset by the client after 50 ms | host | 10 | 0 | 0 | 0 | 10 | 0 % (0–28) | – |
| raw TCP reset by the client after 200 ms | host | 10 | 0 | 0 | 0 | 10 | 0 % (0–28) | – |
| raw TCP, server closes at once (client socket lives ~1 ms, no TIME_WAIT) | host | 10 | 0 | 0 | 0 | 10 | 0 % (0–28) | – |
| one UDP datagram, connected socket (like QUIC) | host | 10 | 0 | 0 | 0 | 10 | 0 % (0–28) | – |
| one UDP datagram, unconnected socket (sendto) | host | 10 | 0 | 0 | 0 | 10 | 0 % (0–28) | – |
| detached helper sends 0.2 s after the app exits | payload | 30 | 30 | 0 | 0 | 0 | 100 % (89–100) | – |
| detached helper sends 1.5 s after the app exits | payload | 30 | 30 | 0 | 0 | 0 | 100 % (89–100) | – |
| detached helper sends 3 s after the app exits | payload | 30 | 30 | 0 | 0 | 0 | 100 % (89–100) | – |
| detached helper sends 8 s after the app exits | payload | 30 | 30 | 0 | 0 | 0 | 100 % (89–100) | – |
| grandchild sends after its parent exited | payload | 30 | 30 | 0 | 0 | 0 | 100 % (89–100) | – |
| child process lives ~100 ms and connects directly | host | 10 | 0 | 0 | 0 | 10 | 0 % (0–28) | – |
| body with this machine’s identifiers and decoys | payload | 3 | 3 | 0 | 0 | 0 | 100 % (44–100) | – |
| identifiers in the 5th of 6 WebSocket messages | payload | 18 | 18 | 0 | 0 | 0 | 100 % (82–100) | – |

