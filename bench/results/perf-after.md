# Performance: after

Run 2026-10-21T19:33:42.440Z on Darwin 25.6.0 arm64, 8 CPUs, Node v26.12.0, load average 3.3 / 3.9 / 4.5 (1/5/15 min, a working desktop). Client: Node https to the lab over the LAN address.

## 300 × 1 KiB POST, one keep-alive connection

| | p50 ms | p95 ms | p99 ms | MiB/s | peak RSS MiB | CPU s | tool CPU s |
|---|---|---|---|---|---|---|---|
| direct | 0.2 | 0.5 | 2.4 | – | 56 | 0.15 | – |
| whatleaks | 0.6 | 2.7 | 7.8 | – | 168 | 2.26 | 2.11 |
| mitmproxy | 1.2 | 1.5 | 1.9 | – | 91 | 0.92 | 0.92 |
| httptoolkit | 13.4 | 25.9 | 38.1 | – | 344 | 2.94 | 2.94 |

## 100 × 1 KiB POST, new connection each (TLS handshake each)

| | p50 ms | p95 ms | p99 ms | MiB/s | peak RSS MiB | CPU s | tool CPU s |
|---|---|---|---|---|---|---|---|
| direct | 5.9 | 11.1 | 12.6 | – | 56 | 0.31 | – |
| whatleaks | 9.4 | 17.8 | 23.1 | – | 143 | 2.81 | 2.50 |
| mitmproxy | 13.6 | 20.2 | 30.4 | – | 88 | 1.55 | 1.55 |
| httptoolkit | 13.4 | 29.4 | 49.4 | – | 312 | 1.00 | 1.00 |

## 10 × 4 MiB POST, keep-alive

| | p50 ms | p95 ms | p99 ms | MiB/s | peak RSS MiB | CPU s | tool CPU s |
|---|---|---|---|---|---|---|---|
| direct | 7.1 | 37.6 | 37.6 | 385.7 | 65 | 0.12 | – |
| whatleaks | 38.5 | 110.4 | 110.4 | 79.0 | 492 | 3.69 | 3.57 |
| mitmproxy | 16.1 | 53.2 | 53.2 | 204.7 | 302 | 0.72 | 0.72 |
| httptoolkit | 40.3 | 78.8 | 78.8 | 87.6 | 351 | 0.57 | 0.57 |

## Startup and exit

One-request app, 10 runs each, median wall time: bare 89 ms, under whatleaks 2143 ms (+2054 ms, which includes the default 1 s grace period after exit).

