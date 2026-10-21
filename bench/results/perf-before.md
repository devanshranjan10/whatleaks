# Performance: before

Run 2026-10-21T12:16:00.645Z on Darwin 25.6.0 arm64, 8 CPUs, Node v26.0.0. Client: Node https to the lab over the LAN address.

## 300 × 1 KiB POST, one keep-alive connection

| | p50 ms | p95 ms | p99 ms | MiB/s | tool peak RSS MiB | tool CPU s |
|---|---|---|---|---|---|---|
| direct | 0.2 | 0.3 | 0.6 | – | – | – |
| whatleaks | 0.7 | 1.7 | 5.0 | – | 144 | 2.66 |
| mitmproxy | 1.2 | 1.7 | 4.7 | – | 90 | 0.92 |

## 100 × 1 KiB POST, new connection each (TLS handshake each)

| | p50 ms | p95 ms | p99 ms | MiB/s | tool peak RSS MiB | tool CPU s |
|---|---|---|---|---|---|---|
| direct | 3.3 | 5.9 | 10.2 | – | – | – |
| whatleaks | 14.1 | 21.8 | 52.7 | – | 179 | 3.38 |
| mitmproxy | 11.6 | 14.8 | 19.9 | – | 88 | 1.42 |

## 10 × 4 MiB POST, keep-alive

| | p50 ms | p95 ms | p99 ms | MiB/s | tool peak RSS MiB | tool CPU s |
|---|---|---|---|---|---|---|
| direct | 6.5 | 35.5 | 35.5 | 419.6 | – | – |
| whatleaks | 45.8 | 141.9 | 141.9 | 73.5 | – | – |
| mitmproxy | 18.5 | 114.1 | 114.1 | 143.4 | 294 | 0.93 |

## Startup and exit

One-request app, 10 runs each, median wall time: bare 131 ms, under whatleaks 3731 ms (+3600 ms, which includes the default 1 s grace period after exit).

