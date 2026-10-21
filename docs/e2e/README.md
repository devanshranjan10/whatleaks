# Real end-to-end runs

Every number in the main README comes from the runs on this page. They were all done
on 2026-10-21, on macOS 26.6.2 (arm64). whatleaks ran on Node 26.0.0 from its built
`dist/cli.js`. The tools under test were installed in scratch folders under `/tmp`.

The `.txt` and `.md` files in this folder are the terminal and Markdown output, made
from the saved captures with the final build:
- `whatleaks report <har>` for single runs
- `whatleaks diff <before> <after>` for comparisons. This prints the same diff that
  `compare` prints at the end of a run.

The raw HAR files are not committed because they hold real install ids. Scrubbed copies
of the Next.js captures are under `test/fixtures/real/` and drive regression tests
(`test/real.test.ts`).

## 1. Next.js 16.4.2, `next build`

**Setup.** A two-file app (`app/layout.js` and `app/page.js`), with
`npm install next@16.4.2 react react-dom --ignore-scripts`. The build ran with the
official Node **22.23.3** binary first on `PATH`; it was checksum-verified against
nodejs.org's SHASUMS256. See §3 for why Node 22.

### Ground truth

```
NEXT_TELEMETRY_DEBUG=1 ./node_modules/.bin/next build
```

Next.js documents that this mode prints each telemetry event and sends nothing. It
printed **22 events with 7 distinct names**:

| Event | Count |
|---|---:|
| `NEXT_BUILD_FEATURE_USAGE` | 14 |
| `NEXT_PACKAGE_DETECTED` | 3 |
| `NEXT_CLI_SESSION_STARTED` | 1 |
| `NEXT_AGENT_UPGRADE_POLICY_DETECTED` | 1 |
| `NEXT_TYPE_CHECK_COMPLETED` | 1 |
| `NEXT_BUILD_COMPLETED` | 1 |
| `NEXT_BUILD_OPTIMIZED` | 1 |

### Single run

```
whatleaks run --label next-build -- ./node_modules/.bin/next build
```

- whatleaks captured **8 POST requests to `telemetry.nextjs.org/api/v1/record`**
  (status 204), carrying exactly **the same 22 events with the same per-name counts**.
  This was checked by parsing the captured bodies.
- It also captured one request that is not telemetry:
  `POST registry.npmjs.org/-/npm/v1/security/advisories/bulk` with body
  `{"next":["16.4.2"]}`.
- The report found:
  - 91 payload fields
  - three ids repeated across all 8 requests: `context.anonymousId`,
    `context.projectId` and `context.sessionId`
  - none of this machine's identifiers (username, hostname, home path, MAC, machine
    id, git email or name, project path). A `grep` of the raw HAR for the username,
    hostname, home path and git email also found none.

Output: [`next-build-report.txt`](next-build-report.txt) and
[`next-build-report.md`](next-build-report.md).

### `compare` with every documented opt-out

```
whatleaks compare --out-dir … -- ./node_modules/.bin/next build
```

- Telemetry requests went from **8 to 0** with all 32 documented opt-out variables
  set (`NEXT_TELEMETRY_DISABLED=1` among them).
- The npm advisory check ran in both runs (1 → 1). It is not affected by telemetry
  settings.

Output: [`next-build-all-opt-outs.txt`](next-build-all-opt-outs.txt) and
[`next-build-all-opt-outs.md`](next-build-all-opt-outs.md).

### `compare` with only `DO_NOT_TRACK=1`

```
whatleaks compare --no-known-opt-outs --off-env DO_NOT_TRACK=1 --strict -- ./node_modules/.bin/next build
```

- Telemetry requests went from **8 to 8**, and the exit code was 1 (`--strict`).
- **`context.anonymousId` and `context.projectId` were identical in both runs**, so
  they persist on disk.
- `context.sessionId` changed between the runs.
- A second, separate comparison gave the same 8 → 8 result.
- This is documented behaviour: nextjs.org/telemetry names `NEXT_TELEMETRY_DISABLED`
  as the opt-out and does not mention `DO_NOT_TRACK`.

Output: [`next-build-do-not-track.txt`](next-build-do-not-track.txt) and
[`next-build-do-not-track.md`](next-build-do-not-track.md).

### Observation: Next.js records which AI agent ran the build

- Every captured telemetry body has `meta.agentName: "claude-code_2-1-306_agent"`.
  These builds were run by Claude Code.
- Turborepo sends an `ai_agent` event and an `x-ai-agent` header in the same
  situation (§2).

## 2. Turborepo 2.11.10, `turbo run build`

**Setup.** A one-package npm workspace with a `turbo.json`, using
`npm install turbo --ignore-scripts`. `turbo` is a Rust binary.

### Ground truth

`TURBO_TELEMETRY_DEBUG=1 turbo run build` printed **17 events**.

### Single run

```
whatleaks run -- ./node_modules/.bin/turbo run build
```

- whatleaks captured **one POST to `telemetry.vercel.com/api/turborepo/v1/events`**
  carrying **10 events**, plus `x-turbo-telemetry-id` and `x-turbo-session-id`
  headers. Its status was "aborted": turbo exited before the response arrived.
- The other 7 events never reached the proxy. Turborepo's source explains why
  (`crates/turborepo-telemetry/src/lib.rs`, read 2026-10-21):
  - Events are sent in batches of 10 (`BUFFER_THRESHOLD`), each from a fire-and-forget
    task.
  - At exit, turbo waits at most 1 s (`EVENT_TIMEOUT`) for its telemetry worker to
    finish, then the process ends.
  - The final 7-event batch did not get a request started before exit. A
    request-initiated hook, added after this run, confirmed that no second request
    began.
- whatleaks reports what crossed the wire. A debug log reports what a tool *meant* to
  send.
- **Not established:** whether a direct, unproxied connection would win that race more
  often. whatleaks cannot measure that.
- **Correction to the research notes:** the shipped binary **accepted** the whatleaks
  CA on macOS. The payload was fully readable, most likely through `SSL_CERT_FILE`
  (rustls-native-certs reads it). The research agent had expected it to refuse.

### `compare` with only `DO_NOT_TRACK=1`

Telemetry requests went **1 → 0**. Turborepo documents `DO_NOT_TRACK` support. A
repeat comparison gave the same result.

Output: [`turbo-run-report.txt`](turbo-run-report.txt),
[`turbo-run-report.md`](turbo-run-report.md),
[`turbo-run-do-not-track.txt`](turbo-run-do-not-track.txt) and
[`turbo-run-do-not-track.md`](turbo-run-do-not-track.md).

## 3. Next.js telemetry fails silently on Node 24 and 26

On the first attempt, under Node 26.0.0, whatleaks showed **no** telemetry from
`next build`. To find out why, I added a throwaway `--require` hook that logs every
`fetch` call. It was used for this investigation only and is not part of whatleaks.

| Node | Telemetry `fetch` calls | Result |
|---|---:|---|
| 26.0.0 (Homebrew) | 16 | all threw `RequestInit: Expected signal ("AbortSignal {}") to be an instance of AbortSignal.` inside the process |
| 24.22.0 (official) | 16 | same error |
| 22.23.3 (official) | 8 | 204 from telemetry.nextjs.org |
| 22.19.0 | 8 | 204 |
| 20.20.2 (Homebrew) | 8 | 204 |

- The failure happens with and without whatleaks, so it is not caused by the proxy.
- On Node 24 and 26, whatleaks' "0 telemetry requests" was correct: nothing left the
  process.
- The 8 requests on Node 22.19 and 20.20 were real sends to telemetry.nextjs.org. They
  were the only telemetry sent outside whatleaks during this work.

This is also why whatleaks now warns when the `node` on `PATH` is older than 22.21
(or 24.0–24.4). Those versions ignore `NODE_USE_ENV_PROXY`, so Node programs would
bypass whatleaks.

## 4. Smaller checks

- **`node -e "fetch('https://example.com/…')"`** under `whatleaks run`: one request,
  captured with its query string.
- **Plain `http://`:** `fetch` and `curl` against `http://example.com/plain` were both
  captured (status 405 from the server).
- **`https.request` with a gzip-encoded body,** run against example.com: captured, and
  the body was decoded.
