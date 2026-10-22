# Performance: after

Run 2026-10-22T04:37:50.428Z on Darwin 25.6.0 arm64, 8 CPUs, Node v26.12.0, load average 2 / 2.5 / 3.2 (1/5/15 min, a working desktop). Client: Node https to the lab over the LAN address.

## 300 × 1 KiB POST, one keep-alive connection

| | p50 ms | p95 ms | p99 ms | MiB/s | peak RSS MiB | CPU s | tool CPU s |
|---|---|---|---|---|---|---|---|
| direct | 0.2 | 0.5 | 1.9 | – | 56 | 0.15 | – |
| whatleaks | 0.5 | 1.1 | 3.7 | – | 136 | 1.68 | 1.53 |
| mitmproxy | 1.2 | 1.4 | 1.6 | – | 91 | 0.79 | 0.79 |
| httptoolkit | 13.3 | 25.1 | 32.1 | – | 338 | 2.85 | 2.85 |

## 100 × 1 KiB POST, new connection each (TLS handshake each)

| | p50 ms | p95 ms | p99 ms | MiB/s | peak RSS MiB | CPU s | tool CPU s |
|---|---|---|---|---|---|---|---|
| direct | 6.1 | 8.0 | 13.7 | – | 58 | 0.30 | – |
| whatleaks | 8.5 | 11.1 | 13.3 | – | 127 | 2.02 | 1.72 |
| mitmproxy | 10.7 | 15.7 | 20.5 | – | 88 | 1.24 | 1.24 |
| httptoolkit | 13.1 | 28.5 | 44.7 | – | 239 | 0.99 | 0.99 |

## 10 × 4 MiB POST, keep-alive

| | p50 ms | p95 ms | p99 ms | MiB/s | peak RSS MiB | CPU s | tool CPU s |
|---|---|---|---|---|---|---|---|
| direct | 6.9 | 30.4 | 30.4 | 406.0 | 65 | 0.12 | – |
| whatleaks | 14.4 | 55.2 | 55.2 | 211.0 | 305 | 1.94 | 1.82 |
| mitmproxy | 14.0 | 41.6 | 41.6 | 239.0 | 301 | 0.66 | 0.66 |
| httptoolkit | 36.8 | 90.9 | 90.9 | 92.9 | 272 | 0.56 | 0.56 |

## Startup and exit

One-request app, 10 runs each, median wall time: bare 92 ms, under whatleaks 1964 ms (+1872 ms, which includes the default 1 s grace period after exit).

