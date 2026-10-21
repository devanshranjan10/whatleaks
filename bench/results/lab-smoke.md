# Lab benchmark: smoke

Run 2026-10-21T05:41:38.927Z on Darwin 25.6.0 arm64, 8 CPUs. whatleaks 0.1.0; mitmproxy Mitmproxy: 12.2.3.

## whatleaks

Attempts 12: payload 42 %, request 0 %, host only 25 %, **silently missed 33 %** (4).

| Scenario | Best possible | Attempts | payload | request | host | missed | at best (95 % CI) | unexpected |
|---|---|---|---|---|---|---|---|---|
| Node 26 fetch | payload | 3 | 3 | 0 | 0 | 0 | 100 % (44–100) | – |
| Go 1.26 net/http | host | 3 | 0 | 0 | 3 | 0 | 100 % (44–100) | – |
| Java 25 HttpClient | payload | 3 | 0 | 0 | 0 | 3 | 0 % (0–56) | – |
| Node WebSocket, 2 messages | payload | 2 | 2 | 0 | 0 | 0 | 100 % (34–100) | – |
| raw TCP held 100 ms | host | 1 | 0 | 0 | 0 | 1 | 0 % (0–79) | – |

## mitmproxy

Attempts 12: payload 25 %, request 17 %, host only 25 %, **silently missed 33 %** (4).

| Scenario | Best possible | Attempts | payload | request | host | missed | at best (95 % CI) | unexpected |
|---|---|---|---|---|---|---|---|---|
| Node 26 fetch | payload | 3 | 3 | 0 | 0 | 0 | 100 % (44–100) | – |
| Go 1.26 net/http | host | 3 | 0 | 0 | 3 | 0 | 100 % (44–100) | – |
| Java 25 HttpClient | payload | 3 | 0 | 0 | 0 | 3 | 0 % (0–56) | – |
| Node WebSocket, 2 messages | payload | 2 | 0 | 2 | 0 | 0 | 0 % (0–66) | – |
| raw TCP held 100 ms | host | 1 | 0 | 0 | 0 | 1 | 0 % (0–79) | – |

