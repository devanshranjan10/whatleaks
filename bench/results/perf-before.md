# Performance: before

Run 2026-10-21T15:08:05.132Z on Darwin 25.6.0 arm64, 8 CPUs, Node v26.12.0. Client: Node https to the lab over the LAN address.

## 300 × 1 KiB POST, one keep-alive connection

| | p50 ms | p95 ms | p99 ms | MiB/s | peak RSS MiB | CPU s | tool CPU s |
|---|---|---|---|---|---|---|---|
| direct | 0.4 | 0.9 | 1.3 | – | 56 | 0.23 | – |
| whatleaks | 1.3 | 4.3 | 9.2 | – | 132 | 3.99 | 3.76 |
| mitmproxy | 1.9 | 5.2 | 7.3 | – | 89 | 1.47 | 1.47 |

## 100 × 1 KiB POST, new connection each (TLS handshake each)

| | p50 ms | p95 ms | p99 ms | MiB/s | peak RSS MiB | CPU s | tool CPU s |
|---|---|---|---|---|---|---|---|
| direct | 7.2 | 10.6 | 17.1 | – | 56 | 0.42 | – |
| whatleaks | 24.4 | 42.0 | 75.9 | – | 177 | 5.18 | 4.76 |
| mitmproxy | 22.0 | 45.0 | 53.6 | – | 87 | 2.63 | 2.63 |

## 10 × 4 MiB POST, keep-alive

| | p50 ms | p95 ms | p99 ms | MiB/s | peak RSS MiB | CPU s | tool CPU s |
|---|---|---|---|---|---|---|---|
| direct | 11.9 | 61.4 | 61.4 | 236.0 | 65 | 0.19 | – |
| whatleaks | 61.6 | 192.0 | 192.0 | 54.1 | – | – | – |
| mitmproxy | 41.7 | 140.0 | 140.0 | 68.5 | 295 | 1.32 | 1.32 |

## Startup and exit

One-request app, 10 runs each, median wall time: bare 162 ms, under whatleaks 3812 ms (+3650 ms, which includes the default 1 s grace period after exit).

