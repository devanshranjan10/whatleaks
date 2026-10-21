# whatleaks report: `fake-tool build`

Captured 2026-10-21T10:00:00.000Z for 1m 00s, exit code 0. Label: `on`. Source: whatleaks 0.1.0.

## Summary

| | |
|---|---|
| Requests | 9 |
| Destinations | 6 |
| Endpoints | 6 |
| Sent (approx.) | 2.3 KB |
| To telemetry endpoints | 7 |
| Connections not inspectable | 4 |
| Direct connections (bypassed proxy) | 1 |
| Activity | `▅█▅▃   ▃            ` |

## What it sent about you

| | Finding | Requests | Where | Form |
|---|---|---:|---|---|
| 🔴 | A MAC address of this machine | 3 | `batch[].context.device.id` | sha256 |
| 🔴 | Your home directory path | 3 | `batch[].properties.cwd` | raw |
| 🔴 | Your OS username | 2 | `[].user`, `user.key` | md5, raw |
| 🔴 | Your computer's hostname | 1 | `body` | raw |
| 🔴 | This machine's hardware/OS ID | 1 | `url` | raw |
| 🔴 | Your git email address | 1 | `[].email` | raw |
| 🔴 | An email address | 1 | `[].contact` | raw |
| 🔴 | Your git user name | 1 | `body:strings` | raw |
| 🟡 | Repeated identifiers | 3 | `batch[].anonymousId`, `batch[].context.device.id` | raw |

Repeated identifiers (same value in several requests; compare two runs with `whatleaks diff` to see which survive a restart):

- `0f8f…950e` in 3 requests, at `batch[].anonymousId`
- `‹sha256(mac)›` in 3 requests, at `batch[].context.device.id`

## Where it went

| Destination | Category | Requests | Sent (approx.) |
|---|---|---:|---:|
| `api.segment.io` | analytics · Segment | 3 | 1.4 KB |
| `collector.example.net` | analytics? | 1 | 155 B |
| `telemetry.example-tool.dev` | analytics? | 1 | 265 B |
| `o123.ingest.sentry.io` | errors · Sentry | 1 | 172 B |
| `flags.example.com` | flags? | 1 | 165 B |
| `registry.npmjs.org` | other | 2 | 156 B |

## Endpoints

### `POST api.segment.io/v1/batch`

- **3 requests** · first at +1.0s · last at +21.0s · median gap 10.0 s · 3/min · ≈1.4 KB sent
- Category: analytics (known host: Segment (segment.io))
- Status: 200 ×3
- Body: json ×3
- User-Agent: `fake-tool/1.2.3 (darwin arm64)`

| Field | Seen in | Distinct | Example | Notes |
|---|---:|---:|---|---|
| `batch[].anonymousId` | 3/3 | 1 | `0f8f…950e` | id-like, same every time |
| `batch[].context.device.id` | 3/3 | 1 | `‹sha256(mac)›` | id-like, same every time |
| `batch[].context.os.name` | 3/3 | 1 | `macOS` | same every time |
| `batch[].event` | 3/3 | 1 | `Build Completed` | same every time |
| `batch[].properties.cwd` | 3/3 | 1 | `‹home›/projects/app` | same every time |
| `batch[].properties.durationMs` | 3/3 | 3 | `1234` |  |
| `batch[].type` | 3/3 | 1 | `track` | same every time |
| `header:authorization` | 3/3 | 1 | `‹redacted›` | same every time |

<details><summary>Sample 1 at +1.0s</summary>

URL: `https://api.segment.io/v1/batch`

```json
{
  "batch": [
    {
      "type": "track",
      "event": "Build Completed",
      "anonymousId": "0f8f…950e",
      "context": {
        "os": {
          "name": "macOS"
        },
        "device": {
          "id": "‹sha256(mac)›"
        }
      },
      "properties": {
        "cwd": "‹home›/projects/app",
        "durationMs": 1234
      }
    }
  ]
}
```

</details>

<details><summary>Sample 2 at +11.0s</summary>

URL: `https://api.segment.io/v1/batch`

```json
{
  "batch": [
    {
      "type": "track",
      "event": "Build Completed",
      "anonymousId": "0f8f…950e",
      "context": {
        "os": {
          "name": "macOS"
        },
        "device": {
          "id": "‹sha256(mac)›"
        }
      },
      "properties": {
        "cwd": "‹home›/projects/app",
        "durationMs": 2345
      }
    }
  ]
}
```

</details>

### `POST collector.example.net/v1/traces`

- **1 request** · first at +7.0s · last at +7.0s · 1/min · ≈155 B sent
- Category: analytics? (guessed from path segment "/traces")
- Status: 200 ×1
- Body: binary ×1

| Field | Seen in | Distinct | Example | Notes |
|---|---:|---:|---|---|
| `body:strings` | 1/1 | 2 | `‹git-name›` |  |

<details><summary>Sample 1 at +7.0s</summary>

URL: `https://collector.example.net/v1/traces`

```text
‹binary, 31 bytes›
printable strings: ‹git-name› | service.name=fake
```

</details>

### `POST telemetry.example-tool.dev/v1/events`

- **1 request** · first at +5.0s · last at +5.0s · 1/min · ≈265 B sent
- Category: analytics? (guessed from path segment "/events")
- Status: 200 ×1
- Body: ndjson ×1

| Field | Seen in | Distinct | Example | Notes |
|---|---:|---:|---|---|
| `?machine` | 1/1 | 1 | `‹machine-id›` | id-like |
| `[].contact` | 1/1 | 1 | `‹email›` |  |
| `[].email` | 1/1 | 1 | `‹git-email›` |  |
| `[].event` | 1/1 | 1 | `exit` |  |
| `[].user` | 1/1 | 1 | `‹username›` |  |

<details><summary>Sample 1 at +5.0s</summary>

URL: `https://telemetry.example-tool.dev/v1/events?machine=‹machine-id›`

```json
[
  {
    "user": "‹username›",
    "email": "‹git-email›"
  },
  {
    "event": "exit",
    "contact": "‹email›"
  }
]
```

</details>

### `POST o123.ingest.sentry.io/api/:id/envelope/`

- **1 request** · first at +2.0s · last at +2.0s · 1/min · ≈172 B sent
- Category: errors (known host: Sentry (sentry.io))
- Status: 200 ×1
- Body: text ×1

| Field | Seen in | Distinct | Example | Notes |
|---|---:|---:|---|---|
| `body` | 1/1 | 1 | `event from host ‹hostname› crashed` |  |

<details><summary>Sample 1 at +2.0s</summary>

URL: `https://o123.ingest.sentry.io/api/456/envelope/`

```text
event from host ‹hostname› crashed
```

</details>

### `POST flags.example.com/sdk/evalx/abc`

- **1 request** · first at +6.0s · last at +6.0s · 1/min · ≈165 B sent
- Category: flags? (guessed from path segment "/evalx")
- Status: 200 ×1
- Body: json ×1

| Field | Seen in | Distinct | Example | Notes |
|---|---:|---:|---|---|
| `user.key` | 1/1 | 1 | `‹md5(username)›` | id-like |

<details><summary>Sample 1 at +6.0s</summary>

URL: `https://flags.example.com/sdk/evalx/abc`

```json
{
  "user": {
    "key": "‹md5(username)›"
  }
}
```

</details>

### `GET registry.npmjs.org/left-pad`

- **2 requests** · first at +3.0s · last at +4.0s · median gap 1.0 s · 2/min · ≈156 B sent
- Category: other
- Status: 200 ×2
- Body: empty ×2

## Not visible to whatleaks

- `pinned.example`: 3 connections did not accept the whatleaks certificate (cert-rejected). Contents unknown.
- `bank.example:443`: 1 connection tunnelled without decrypting (`--no-decrypt`).
- `140.82.112.3:443` (`lb-140-82-112-3-iad.github.com`) TCP: direct connection by `git` that bypassed the proxy.

## Notes

- 3 connections to 1 host did not accept the whatleaks certificate, so their contents are not in this report.

---

Generated by whatleaks 0.1.0. Redacted: `‹labels›` replace local identifiers and secrets, and ids are masked. Classification marked "?" is a guess from the URL.
