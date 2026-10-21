# Performance: after

Run 2026-10-21T16:27:06.349Z on Darwin 25.6.0 arm64, 8 CPUs, Node v26.12.0, load average 9.4 / 10.8 / 11.1 (1/5/15 min, a working desktop). Client: Node https to the lab over the LAN address.

## 300 × 1 KiB POST, one keep-alive connection

| | p50 ms | p95 ms | p99 ms | MiB/s | peak RSS MiB | CPU s | tool CPU s |
|---|---|---|---|---|---|---|---|
| direct | 0.2 | 0.3 | 0.5 | – | 56 | 0.12 | – |
| whatleaks | 0.5 | 1.5 | 3.3 | – | 149 | 2.29 | 2.17 |
| mitmproxy | 1.3 | 2.2 | 3.9 | – | 90 | 1.08 | 1.08 |

## 100 × 1 KiB POST, new connection each (TLS handshake each)

| | p50 ms | p95 ms | p99 ms | MiB/s | peak RSS MiB | CPU s | tool CPU s |
|---|---|---|---|---|---|---|---|
| direct | 5.7 | 9.6 | 12.9 | – | 57 | 0.33 | – |
| whatleaks | 17.2 | 29.7 | 45.1 | – | 256 | 4.24 | 3.91 |
| mitmproxy | 13.7 | 24.1 | 29.9 | – | 88 | 1.62 | 1.62 |

## 10 × 4 MiB POST, keep-alive

| | p50 ms | p95 ms | p99 ms | MiB/s | peak RSS MiB | CPU s | tool CPU s |
|---|---|---|---|---|---|---|---|
| direct | 9.6 | 178.3 | 178.3 | 146.4 | 63 | 0.17 | – |
| whatleaks | 42.2 | 147.8 | 147.8 | 73.5 | 521 | 3.59 | 3.42 |
| mitmproxy | 15.2 | 49.0 | 49.0 | 214.1 | 301 | 0.78 | 0.78 |

## Startup and exit

One-request app, 10 runs each, median wall time: bare 90 ms, under whatleaks 2132 ms (+2042 ms, which includes the default 1 s grace period after exit).

