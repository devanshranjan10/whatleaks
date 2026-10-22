# Lab benchmark: after

Run 2026-10-22T02:31:02.469Z on Darwin 25.6.0 arm64, 8 CPUs. whatleaks 0.1.0 (/tmp/wlb/after/dist/cli.js); mitmproxy Mitmproxy: 12.2.3.

## whatleaks

Attempts 594: payload 74 %, request 1 %, host only 23 %, **silently missed 3 %** (17).

| Scenario | Best possible | Attempts | payload | request | host | missed | at best (95 % CI) | unexpected |
|---|---|---|---|---|---|---|---|---|
| Node 26 fetch | payload | 9 | 9 | 0 | 0 | 0 | 100 % (70–100) | – |
| Node 26 https.request | payload | 9 | 9 | 0 | 0 | 0 | 100 % (70–100) | – |
| Node 26 https.request with its own keep-alive Agent | payload | 9 | 9 | 0 | 0 | 0 | 100 % (70–100) | – |
| Node 22.23 https.request with its own keep-alive Agent | payload | 9 | 9 | 0 | 0 | 0 | 100 % (70–100) | – |
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
| Apple /usr/bin/python3 urllib (LibreSSL) | payload | 9 | 9 | 0 | 0 | 0 | 100 % (70–100) | – |
| Ruby 2.6 Net::HTTP (macOS system) | payload | 9 | 9 | 0 | 0 | 0 | 100 % (70–100) | – |
| Go 1.26 net/http | host | 9 | 0 | 0 | 9 | 0 | 100 % (70–100) | – |
| Java 25 HttpClient | payload | 9 | 9 | 0 | 0 | 0 | 100 % (70–100) | – |
| Node WebSocket, 2 messages | payload | 6 | 6 | 0 | 0 | 0 | 100 % (61–100) | – |
| Node WebSocket, 20 messages | payload | 60 | 60 | 0 | 0 | 0 | 100 % (94–100) | – |
| 9 MiB upload | request | 3 | 0 | 3 | 0 | 0 | 100 % (44–100) | – |
| client pinning its own trust store | host | 3 | 0 | 0 | 3 | 0 | 100 % (44–100) | – |
| Node http2 module (ignores proxy variables) | payload | 10 | 10 | 0 | 0 | 0 | 100 % (72–100) | – |
| Python aiohttp (ignores proxy variables by default) | payload | 30 | 30 | 0 | 0 | 0 | 100 % (89–100) | – |
| raw TCP held 10 ms | host | 10 | 0 | 0 | 10 | 0 | 100 % (72–100) | – |
| raw TCP held 100 ms | host | 10 | 0 | 0 | 10 | 0 | 100 % (72–100) | – |
| raw TCP held 500 ms | host | 10 | 0 | 0 | 10 | 0 | 100 % (72–100) | – |
| raw TCP held 2 s | host | 10 | 0 | 0 | 10 | 0 | 100 % (72–100) | – |
| raw TCP reset by the client after 10 ms | host | 10 | 0 | 0 | 10 | 0 | 100 % (72–100) | – |
| raw TCP reset by the client after 50 ms | host | 10 | 0 | 0 | 10 | 0 | 100 % (72–100) | – |
| raw TCP reset by the client after 200 ms | host | 10 | 0 | 0 | 10 | 0 | 100 % (72–100) | – |
| raw TCP, server closes at once (client socket lives ~1 ms, no TIME_WAIT) | host | 10 | 0 | 0 | 10 | 0 | 100 % (72–100) | – |
| one UDP datagram, connected socket (like QUIC) | host | 10 | 0 | 0 | 10 | 0 | 100 % (72–100) | – |
| one UDP datagram, unconnected socket (sendto) | host | 10 | 0 | 0 | 10 | 0 | 100 % (72–100) | – |
| Go raw TCP reset after 10 ms (no runtime hook) | host | 10 | 0 | 0 | 3 | 7 | 30 % (11–60) | – |
| Go raw TCP, server closes at once (no runtime hook) | host | 10 | 0 | 0 | 10 | 0 | 100 % (72–100) | – |
| Go UDP datagram, unconnected socket (no runtime hook) | host | 10 | 0 | 0 | 0 | 10 | 0 % (0–28) | – |
| detached helper sends 0.2 s after the app exits | payload | 30 | 30 | 0 | 0 | 0 | 100 % (89–100) | – |
| detached helper sends 1.5 s after the app exits | payload | 30 | 30 | 0 | 0 | 0 | 100 % (89–100) | – |
| detached helper sends 3 s after the app exits | payload | 30 | 30 | 0 | 0 | 0 | 100 % (89–100) | – |
| detached helper sends 8 s after the app exits | payload | 30 | 30 | 0 | 0 | 0 | 100 % (89–100) | – |
| grandchild sends after its parent exited | payload | 30 | 30 | 0 | 0 | 0 | 100 % (89–100) | – |
| child process lives ~100 ms and connects directly | host | 10 | 0 | 0 | 10 | 0 | 100 % (72–100) | – |
| body with this machine’s identifiers and decoys | payload | 3 | 3 | 0 | 0 | 0 | 100 % (44–100) | – |
| identifiers in the 5th of 6 WebSocket messages | payload | 18 | 18 | 0 | 0 | 0 | 100 % (82–100) | – |

## mitmproxy

Attempts 594: payload 57 %, request 0 %, host only 5 %, **silently missed 38 %** (225).

| Scenario | Best possible | Attempts | payload | request | host | missed | at best (95 % CI) | unexpected |
|---|---|---|---|---|---|---|---|---|
| Node 26 fetch | payload | 9 | 9 | 0 | 0 | 0 | 100 % (70–100) | – |
| Node 26 https.request | payload | 9 | 9 | 0 | 0 | 0 | 100 % (70–100) | – |
| Node 26 https.request with its own keep-alive Agent | payload | 9 | 0 | 0 | 0 | 9 | 0 % (0–30) | – |
| Node 22.23 https.request with its own keep-alive Agent | payload | 9 | 0 | 0 | 0 | 9 | 0 % (0–30) | – |
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
| Apple /usr/bin/python3 urllib (LibreSSL) | payload | 9 | 0 | 0 | 9 | 0 | 0 % (0–30) | – |
| Ruby 2.6 Net::HTTP (macOS system) | payload | 9 | 0 | 0 | 9 | 0 | 0 % (0–30) | – |
| Go 1.26 net/http | host | 9 | 0 | 0 | 9 | 0 | 100 % (70–100) | – |
| Java 25 HttpClient | payload | 9 | 0 | 0 | 0 | 9 | 0 % (0–30) | – |
| Node WebSocket, 2 messages | payload | 6 | 6 | 0 | 0 | 0 | 100 % (61–100) | – |
| Node WebSocket, 20 messages | payload | 60 | 60 | 0 | 0 | 0 | 100 % (94–100) | – |
| 9 MiB upload | request | 3 | 3 | 0 | 0 | 0 | 100 % (44–100) | – |
| client pinning its own trust store | host | 3 | 0 | 0 | 3 | 0 | 100 % (44–100) | – |
| Node http2 module (ignores proxy variables) | payload | 10 | 0 | 0 | 0 | 10 | 0 % (0–28) | – |
| Python aiohttp (ignores proxy variables by default) | payload | 30 | 0 | 0 | 0 | 30 | 0 % (0–11) | – |
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
| Go raw TCP reset after 10 ms (no runtime hook) | host | 10 | 0 | 0 | 0 | 10 | 0 % (0–28) | – |
| Go raw TCP, server closes at once (no runtime hook) | host | 10 | 0 | 0 | 0 | 10 | 0 % (0–28) | – |
| Go UDP datagram, unconnected socket (no runtime hook) | host | 10 | 0 | 0 | 0 | 10 | 0 % (0–28) | – |
| detached helper sends 0.2 s after the app exits | payload | 30 | 30 | 0 | 0 | 0 | 100 % (89–100) | – |
| detached helper sends 1.5 s after the app exits | payload | 30 | 30 | 0 | 0 | 0 | 100 % (89–100) | – |
| detached helper sends 3 s after the app exits | payload | 30 | 30 | 0 | 0 | 0 | 100 % (89–100) | – |
| detached helper sends 8 s after the app exits | payload | 30 | 30 | 0 | 0 | 0 | 100 % (89–100) | – |
| grandchild sends after its parent exited | payload | 30 | 30 | 0 | 0 | 0 | 100 % (89–100) | – |
| child process lives ~100 ms and connects directly | host | 10 | 0 | 0 | 0 | 10 | 0 % (0–28) | – |
| body with this machine’s identifiers and decoys | payload | 3 | 3 | 0 | 0 | 0 | 100 % (44–100) | – |
| identifiers in the 5th of 6 WebSocket messages | payload | 18 | 18 | 0 | 0 | 0 | 100 % (82–100) | – |

## httptoolkit

Attempts 594: payload 31 %, request 0 %, host only 2 %, **silently missed 67 %** (399).

| Scenario | Best possible | Attempts | payload | request | host | missed | at best (95 % CI) | unexpected |
|---|---|---|---|---|---|---|---|---|
| Node 26 fetch | payload | 9 | 0 | 0 | 0 | 9 | 0 % (0–30) | – |
| Node 26 https.request | payload | 9 | 9 | 0 | 0 | 0 | 100 % (70–100) | – |
| Node 26 https.request with its own keep-alive Agent | payload | 9 | 9 | 0 | 0 | 0 | 100 % (70–100) | – |
| Node 22.23 https.request with its own keep-alive Agent | payload | 9 | 9 | 0 | 0 | 0 | 100 % (70–100) | – |
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
| Apple /usr/bin/python3 urllib (LibreSSL) | payload | 9 | 9 | 0 | 0 | 0 | 100 % (70–100) | – |
| Ruby 2.6 Net::HTTP (macOS system) | payload | 9 | 9 | 0 | 0 | 0 | 100 % (70–100) | – |
| Go 1.26 net/http | host | 9 | 0 | 0 | 9 | 0 | 100 % (70–100) | – |
| Java 25 HttpClient | payload | 9 | 9 | 0 | 0 | 0 | 100 % (70–100) | – |
| Node WebSocket, 2 messages | payload | 6 | 0 | 0 | 0 | 6 | 0 % (0–39) | – |
| Node WebSocket, 20 messages | payload | 60 | 0 | 0 | 0 | 60 | 0 % (0–6) | – |
| 9 MiB upload | request | 3 | 0 | 0 | 0 | 3 | 0 % (0–56) | – |
| client pinning its own trust store | host | 3 | 0 | 0 | 3 | 0 | 100 % (44–100) | – |
| Node http2 module (ignores proxy variables) | payload | 10 | 0 | 0 | 0 | 10 | 0 % (0–28) | – |
| Python aiohttp (ignores proxy variables by default) | payload | 30 | 30 | 0 | 0 | 0 | 100 % (89–100) | – |
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
| Go raw TCP reset after 10 ms (no runtime hook) | host | 10 | 0 | 0 | 0 | 10 | 0 % (0–28) | – |
| Go raw TCP, server closes at once (no runtime hook) | host | 10 | 0 | 0 | 0 | 10 | 0 % (0–28) | – |
| Go UDP datagram, unconnected socket (no runtime hook) | host | 10 | 0 | 0 | 0 | 10 | 0 % (0–28) | – |
| detached helper sends 0.2 s after the app exits | payload | 30 | 0 | 0 | 0 | 30 | 0 % (0–11) | – |
| detached helper sends 1.5 s after the app exits | payload | 30 | 0 | 0 | 0 | 30 | 0 % (0–11) | – |
| detached helper sends 3 s after the app exits | payload | 30 | 0 | 0 | 0 | 30 | 0 % (0–11) | – |
| detached helper sends 8 s after the app exits | payload | 30 | 0 | 0 | 0 | 30 | 0 % (0–11) | – |
| grandchild sends after its parent exited | payload | 30 | 0 | 0 | 0 | 30 | 0 % (0–11) | – |
| child process lives ~100 ms and connects directly | host | 10 | 0 | 0 | 0 | 10 | 0 % (0–28) | – |
| body with this machine’s identifiers and decoys | payload | 3 | 0 | 0 | 0 | 3 | 0 % (0–56) | – |
| identifiers in the 5th of 6 WebSocket messages | payload | 18 | 0 | 0 | 0 | 18 | 0 % (0–18) | – |

