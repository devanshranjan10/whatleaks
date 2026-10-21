# Performance: before

Run 2026-10-21T16:33:02.522Z on Darwin 25.6.0 arm64, 8 CPUs, Node v26.12.0, load average 10.1 / 11 / 11.2 (1/5/15 min, a working desktop). Client: Node https to the lab over the LAN address.

## 300 × 1 KiB POST, one keep-alive connection

| | p50 ms | p95 ms | p99 ms | MiB/s | peak RSS MiB | CPU s | tool CPU s |
|---|---|---|---|---|---|---|---|
| direct | 0.2 | 0.3 | 0.5 | – | 56 | 0.12 | – |
| whatleaks | 0.5 | 1.1 | 2.2 | – | 147 | 2.36 | 2.24 |
| mitmproxy | 1.2 | 1.4 | 1.6 | – | 90 | 0.91 | 0.91 |

## 100 × 1 KiB POST, new connection each (TLS handshake each)

| | p50 ms | p95 ms | p99 ms | MiB/s | peak RSS MiB | CPU s | tool CPU s |
|---|---|---|---|---|---|---|---|
| direct | 6.4 | 9.8 | 18.0 | – | 57 | 0.33 | – |
| whatleaks | 14.5 | 19.5 | 41.8 | – | 187 | 3.30 | 2.97 |
| mitmproxy | 13.8 | 17.5 | 28.2 | – | 88 | 1.47 | 1.47 |

## 10 × 4 MiB POST, keep-alive

| | p50 ms | p95 ms | p99 ms | MiB/s | peak RSS MiB | CPU s | tool CPU s |
|---|---|---|---|---|---|---|---|
| direct | 6.7 | 32.4 | 32.4 | 425.2 | 65 | 0.14 | – |
| whatleaks | 39.7 | 86.5 | 86.5 | 92.3 | – | – | – |
| mitmproxy | 15.4 | 210.4 | 210.4 | 114.2 | 293 | 0.95 | 0.95 |

## Startup and exit

One-request app, 10 runs each, median wall time: bare 97 ms, under whatleaks 3196 ms (+3099 ms, which includes the default 1 s grace period after exit).

