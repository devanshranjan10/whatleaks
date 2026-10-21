# Performance: after

Run 2026-10-21T15:01:36.410Z on Darwin 25.6.0 arm64, 8 CPUs, Node v26.12.0. Client: Node https to the lab over the LAN address.

## 300 × 1 KiB POST, one keep-alive connection

| | p50 ms | p95 ms | p99 ms | MiB/s | peak RSS MiB | CPU s | tool CPU s |
|---|---|---|---|---|---|---|---|
| direct | 0.3 | 0.9 | 1.6 | – | 56 | 0.25 | – |
| whatleaks | 1.6 | 11.1 | 39.3 | – | 141 | 5.57 | 5.32 |
| mitmproxy | 2.6 | 4.7 | 6.0 | – | 89 | 1.87 | 1.87 |

## 100 × 1 KiB POST, new connection each (TLS handshake each)

| | p50 ms | p95 ms | p99 ms | MiB/s | peak RSS MiB | CPU s | tool CPU s |
|---|---|---|---|---|---|---|---|
| direct | 5.8 | 10.1 | 13.7 | – | 57 | 0.47 | – |
| whatleaks | 40.0 | 77.0 | 152.3 | – | 235 | 9.23 | 8.76 |
| mitmproxy | 37.2 | 141.8 | 216.3 | – | 80 | 3.57 | 3.57 |

## 10 × 4 MiB POST, keep-alive

| | p50 ms | p95 ms | p99 ms | MiB/s | peak RSS MiB | CPU s | tool CPU s |
|---|---|---|---|---|---|---|---|
| direct | 28.0 | 221.3 | 221.3 | 80.2 | 64 | 0.31 | – |
| whatleaks | 88.9 | 359.7 | 359.7 | 33.2 | – | – | – |
| mitmproxy | 32.1 | 180.5 | 180.5 | 85.4 | 286 | 1.33 | 1.33 |

## Startup and exit

One-request app, 10 runs each, median wall time: bare 173 ms, under whatleaks 3068 ms (+2895 ms, which includes the default 1 s grace period after exit).

