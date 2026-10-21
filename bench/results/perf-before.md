# Performance: before

Run 2026-10-21T19:40:46.612Z on Darwin 25.6.0 arm64, 8 CPUs, Node v26.12.0, load average 10.6 / 9.8 / 7.2 (1/5/15 min, a working desktop). Client: Node https to the lab over the LAN address.

## 300 × 1 KiB POST, one keep-alive connection

| | p50 ms | p95 ms | p99 ms | MiB/s | peak RSS MiB | CPU s | tool CPU s |
|---|---|---|---|---|---|---|---|
| direct | 0.3 | 1.9 | 10.2 | – | 55 | 0.17 | – |
| whatleaks | 0.8 | 5.3 | 10.1 | – | 119 | 2.93 | 2.76 |
| mitmproxy | 1.2 | 1.8 | 2.2 | – | 89 | 1.23 | 1.23 |
| httptoolkit | 14.9 | 48.0 | 86.5 | – | 200 | 3.74 | 3.74 |

## 100 × 1 KiB POST, new connection each (TLS handshake each)

| | p50 ms | p95 ms | p99 ms | MiB/s | peak RSS MiB | CPU s | tool CPU s |
|---|---|---|---|---|---|---|---|
| direct | 5.5 | 9.2 | 18.1 | – | 55 | 0.33 | – |
| whatleaks | 15.6 | 21.9 | 56.4 | – | 173 | 3.97 | 3.64 |
| mitmproxy | 14.0 | 22.2 | 28.8 | – | 88 | 1.63 | 1.63 |
| httptoolkit | 14.6 | 45.3 | 79.9 | – | 177 | 1.08 | 1.08 |

## 10 × 4 MiB POST, keep-alive

| | p50 ms | p95 ms | p99 ms | MiB/s | peak RSS MiB | CPU s | tool CPU s |
|---|---|---|---|---|---|---|---|
| direct | 8.5 | 34.9 | 34.9 | 268.1 | 65 | 0.12 | – |
| whatleaks | 58.9 | 163.5 | 163.5 | 54.6 | – | – | – |
| mitmproxy | 92.4 | 1185.4 | 1185.4 | 19.1 | 203 | 3.90 | 3.90 |
| httptoolkit | 225.5 | 630.5 | 630.5 | 15.0 | 139 | 2.35 | 2.35 |

## Startup and exit

One-request app, 10 runs each, median wall time: bare 372 ms, under whatleaks 7106 ms (+6734 ms, which includes the default 1 s grace period after exit).

