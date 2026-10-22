# Performance: after

Run 2026-10-22T02:31:54.046Z on Darwin 25.6.0 arm64, 8 CPUs, Node v26.12.0, load average 3.3 / 3.1 / 3 (1/5/15 min, a working desktop). Client: Node https to the lab over the LAN address.

## 300 × 1 KiB POST, one keep-alive connection

| | p50 ms | p95 ms | p99 ms | MiB/s | peak RSS MiB | CPU s | tool CPU s |
|---|---|---|---|---|---|---|---|
| direct | 0.2 | 0.9 | 1.6 | – | 56 | 0.16 | – |
| whatleaks | 0.6 | 1.7 | 3.1 | – | 159 | 2.08 | 1.92 |
| mitmproxy | 1.2 | 1.5 | 2.2 | – | 92 | 0.86 | 0.86 |
| httptoolkit | 13.6 | 24.8 | 34.0 | – | 358 | 3.01 | 3.01 |

## 100 × 1 KiB POST, new connection each (TLS handshake each)

| | p50 ms | p95 ms | p99 ms | MiB/s | peak RSS MiB | CPU s | tool CPU s |
|---|---|---|---|---|---|---|---|
| direct | 5.0 | 7.9 | 10.4 | – | 57 | 0.29 | – |
| whatleaks | 8.4 | 10.4 | 12.0 | – | 137 | 2.52 | 2.23 |
| mitmproxy | 13.8 | 14.9 | 16.0 | – | 89 | 1.42 | 1.42 |
| httptoolkit | 13.3 | 29.1 | 38.1 | – | 312 | 1.00 | 1.00 |

## 10 × 4 MiB POST, keep-alive

| | p50 ms | p95 ms | p99 ms | MiB/s | peak RSS MiB | CPU s | tool CPU s |
|---|---|---|---|---|---|---|---|
| direct | 6.3 | 34.5 | 34.5 | 430.0 | 65 | 0.13 | – |
| whatleaks | 16.9 | 59.6 | 59.6 | 186.5 | 300 | 2.40 | 2.27 |
| mitmproxy | 20.2 | 59.2 | 59.2 | 160.4 | 283 | 0.78 | 0.78 |
| httptoolkit | 38.0 | 58.2 | 58.2 | 102.8 | 336 | 0.59 | 0.59 |

## Startup and exit

One-request app, 10 runs each, median wall time: bare 88 ms, under whatleaks 2037 ms (+1949 ms, which includes the default 1 s grace period after exit).

