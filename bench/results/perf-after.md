# Performance: after

Run 2026-10-21T12:09:57.500Z on Darwin 25.6.0 arm64, 8 CPUs, Node v26.0.0. Client: Node https to the lab over the LAN address.

## 300 × 1 KiB POST, one keep-alive connection

| | p50 ms | p95 ms | p99 ms | MiB/s | tool peak RSS MiB | tool CPU s |
|---|---|---|---|---|---|---|
| direct | 0.2 | 0.3 | 0.5 | – | – | – |
| whatleaks | 0.6 | 1.8 | 3.8 | – | 147 | 3.06 |
| mitmproxy | 1.2 | 1.6 | 4.5 | – | 90 | 0.96 |

## 100 × 1 KiB POST, new connection each (TLS handshake each)

| | p50 ms | p95 ms | p99 ms | MiB/s | tool peak RSS MiB | tool CPU s |
|---|---|---|---|---|---|---|
| direct | 4.4 | 7.9 | 28.2 | – | – | – |
| whatleaks | 18.6 | 42.3 | 57.2 | – | 225 | 5.19 |
| mitmproxy | 13.6 | 25.1 | 29.1 | – | 88 | 1.66 |

## 10 × 4 MiB POST, keep-alive

| | p50 ms | p95 ms | p99 ms | MiB/s | tool peak RSS MiB | tool CPU s |
|---|---|---|---|---|---|---|
| direct | 6.7 | 30.6 | 30.6 | 414.6 | – | – |
| whatleaks | 55.6 | 134.4 | 134.4 | 61.4 | – | – |
| mitmproxy | 17.5 | 216.0 | 216.0 | 106.7 | 288 | 0.86 |

## Startup and exit

One-request app, 10 runs each, median wall time: bare 107 ms, under whatleaks 3031 ms (+2924 ms, which includes the default 1 s grace period after exit).

