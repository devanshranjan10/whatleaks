# whatleaks report: `./node_modules/.bin/next build`

Captured 2026-10-21T04:14:48.968Z for 3.7 s, exit code 0. Label: `default`. Source: whatleaks 0.1.0.

## Summary

| | |
|---|---|
| Requests | 9 |
| Destinations | 2 |
| Endpoints | 2 |
| Sent (approx.) | 10.6 KB |
| To telemetry endpoints | 8 |
| Connections not inspectable | 0 |
| Direct connections (bypassed proxy) | 0 |
| Activity | `  █ ▃   █ ▃▃        ` |

## What it sent about you

| | Finding | Requests | Where | Form |
|---|---|---:|---|---|
| 🟡 | Repeated identifiers | 8 | `context.anonymousId`, `context.projectId`, `context.sessionId` | raw |

Repeated identifiers (same value in several requests; compare two runs with `whatleaks diff` to see which survive a restart):

- `e4a7…4360` in 8 requests, at `context.anonymousId`
- `1597…f2ed` in 8 requests, at `context.projectId`
- `a752…40db` in 8 requests, at `context.sessionId`

## Where it went

| Destination | Category | Requests | Sent (approx.) |
|---|---|---:|---:|
| `telemetry.nextjs.org` | analytics · Next.js telemetry | 8 | 10.3 KB |
| `registry.npmjs.org` | other | 1 | 321 B |

## Endpoints

### `POST telemetry.nextjs.org/api/v1/record`

- **8 requests** · first at +0.5s · last at +2.1s · median gap 223 ms · ≈10.3 KB sent
- Category: analytics (known host: Next.js telemetry (telemetry.nextjs.org))
- Status: 204 ×8
- Body: json ×8
- User-Agent: `node`

| Field | Seen in | Distinct | Example | Notes |
|---|---:|---:|---|---|
| `context.anonymousId` | 8/8 | 1 | `e4a7…4360` | id-like, same every time |
| `context.projectId` | 8/8 | 1 | `1597…f2ed` | id-like, same every time |
| `context.sessionId` | 8/8 | 1 | `a752…40db` | id-like, same every time |
| `events[].eventName` | 8/8 | 7 | `NEXT_CLI_SESSION_STARTED` |  |
| `meta.agentName` | 8/8 | 1 | `claude-code_2-1-306_agent` | same every time |
| `meta.ciName` | 8/8 | 1 | `null` | same every time |
| `meta.cpuCount` | 8/8 | 1 | `8` | same every time |
| `meta.cpuModel` | 8/8 | 1 | `Apple M1` | same every time |
| `meta.cpuSpeed` | 8/8 | 1 | `2400` | same every time |
| `meta.isCI` | 8/8 | 1 | `false` | same every time |
| `meta.isDocker` | 8/8 | 1 | `false` | same every time |
| `meta.isNowDev` | 8/8 | 1 | `false` | same every time |
| `meta.isWsl` | 8/8 | 1 | `false` | same every time |
| `meta.memoryInMb` | 8/8 | 1 | `8192` | same every time |
| `meta.nextVersion` | 8/8 | 1 | `16.4.2` | same every time |
| `meta.systemArchitecture` | 8/8 | 1 | `arm64` | same every time |
| `meta.systemPlatform` | 8/8 | 1 | `darwin` | same every time |
| `meta.systemRelease` | 8/8 | 1 | `25.6.0` | same every time |
| `events[].fields.durationInSeconds` | 3/8 | 2 | `1` |  |
| `events[].fields.featureName` | 2/8 | 14 | `modularizeImports` |  |
| `events[].fields.hasDunderPages` | 2/8 | 1 | `false` | same every time |
| `events[].fields.hasTestPages` | 2/8 | 1 | `false` | same every time |
| `events[].fields.invocationCount` | 2/8 | 2 | `1` |  |
| `events[].fields.isRspack` | 2/8 | 1 | `false` | same every time |
| `events[].fields.totalAppPagesCount` | 2/8 | 1 | `3` | same every time |
| `events[].fields.totalPageCount` | 2/8 | 1 | `0` | same every time |
| `events[].fields.adapterPath` | 1/8 | 1 | `false` |  |
| `events[].fields.appDir` | 1/8 | 1 | `true` |  |
| `events[].fields.basePathEnabled` | 1/8 | 1 | `false` |  |
| `events[].fields.buildTarget` | 1/8 | 1 | `default` |  |
| `events[].fields.bundler` | 1/8 | 1 | `turbopack` |  |
| `events[].fields.cliCommand` | 1/8 | 1 | `build` |  |
| `events[].fields.configuredPolicy` | 1/8 | 1 | `security` |  |
| `events[].fields.dynamicStaleTime` | 1/8 | 1 | `0` |  |
| `events[].fields.edgeRuntimeAppCount` | 1/8 | 1 | `0` |  |
| `events[].fields.edgeRuntimePagesCount` | 1/8 | 1 | `0` |  |
| `events[].fields.effectivePolicy` | 1/8 | 1 | `security` |  |
| `events[].fields.hasBabelConfig` | 1/8 | 1 | `false` |  |
| `events[].fields.hasNextConfig` | 1/8 | 1 | `false` |  |
| `events[].fields.hasNowJson` | 1/8 | 1 | `false` |  |
| `events[].fields.hasReportWebVitals` | 1/8 | 1 | `false` |  |
| `events[].fields.hasStatic404` | 1/8 | 1 | `true` |  |
| `events[].fields.hasWebpackConfig` | 1/8 | 1 | `false` |  |
| `events[].fields.headersCount` | 1/8 | 1 | `0` |  |
| `events[].fields.headersWithHasCount` | 1/8 | 1 | `0` |  |
| `events[].fields.i18nEnabled` | 1/8 | 1 | `false` |  |
| `events[].fields.imageDomainsCount` | 1/8 | 1 | `0` |  |
| `events[].fields.imageEnabled` | 1/8 | 1 | `true` |  |
| `events[].fields.imageFormats` | 1/8 | 1 | `image/webp` |  |
| `events[].fields.imageFutureEnabled` | 1/8 | 1 | `true` |  |
| `events[].fields.imageLoader` | 1/8 | 1 | `default` |  |
| `events[].fields.imageLocalPatternsCount` | 1/8 | 1 | `1` |  |
| `events[].fields.imageQualities` | 1/8 | 1 | `75` |  |
| `events[].fields.imageRemotePatternsCount` | 1/8 | 1 | `0` |  |
| `events[].fields.imageSizes` | 1/8 | 1 | `32,48,64,96,128,256,384` |  |
| `events[].fields.isCustomServer` | 1/8 | 1 | `null` |  |
| `events[].fields.isSrcDir` | 1/8 | 1 | `false` |  |
| `events[].fields.localeDetectionEnabled` | 1/8 | 1 | `null` |  |
| `events[].fields.localeDomainsCount` | 1/8 | 1 | `null` |  |
| `events[].fields.locales` | 1/8 | 1 | `null` |  |
| `events[].fields.middlewareCount` | 1/8 | 1 | `0` |  |
| `events[].fields.nextConfigOutput` | 1/8 | 1 | `null` |  |
| `events[].fields.nextVersion` | 1/8 | 1 | `16.4.2` |  |
| `events[].fields.nodeVersion` | 1/8 | 1 | `v22.23.3` |  |
| `events[].fields.packageName` | 1/8 | 3 | `next` |  |
| `events[].fields.packageVersion` | 1/8 | 2 | `^16.4.2` |  |
| `events[].fields.pagesDir` | 1/8 | 1 | `false` |  |
| `events[].fields.policySource` | 1/8 | 1 | `config` |  |
| `events[].fields.reactCompiler` | 1/8 | 1 | `false` |  |
| `events[].fields.reactCompilerCompilationMode` | 1/8 | 1 | `null` |  |
| `events[].fields.reactCompilerPanicThreshold` | 1/8 | 1 | `null` |  |
| `events[].fields.reactStrictMode` | 1/8 | 1 | `false` |  |
| `events[].fields.redirectsCount` | 1/8 | 1 | `0` |  |
| `events[].fields.redirectsWithHasCount` | 1/8 | 1 | `0` |  |
| `events[].fields.rewritesCount` | 1/8 | 1 | `0` |  |
| `events[].fields.rewritesWithHasCount` | 1/8 | 1 | `0` |  |
| `events[].fields.schemaVersion` | 1/8 | 1 | `1` |  |
| `events[].fields.serverAppPagesCount` | 1/8 | 1 | `0` |  |
| `events[].fields.serverPropsPageCount` | 1/8 | 1 | `0` |  |
| `events[].fields.sourceCommand` | 1/8 | 1 | `build` |  |
| `events[].fields.ssrPageCount` | 1/8 | 1 | `0` |  |
| `events[].fields.staticAppPagesCount` | 1/8 | 1 | `3` |  |
| `events[].fields.staticPageCount` | 1/8 | 1 | `0` |  |
| `events[].fields.staticPropsPageCount` | 1/8 | 1 | `0` |  |
| `events[].fields.staticStaleTime` | 1/8 | 1 | `300` |  |
| `events[].fields.trailingSlashEnabled` | 1/8 | 1 | `false` |  |
| `events[].fields.turboFlag` | 1/8 | 1 | `true` |  |
| `events[].fields.typeCheckMode` | 1/8 | 1 | `typescript-cli` |  |
| `events[].fields.typescriptVersion` | 1/8 | 1 | `null` |  |
| `events[].fields.useTurbopackWorkerAssetPrefix` | 1/8 | 1 | `false` |  |
| `events[].fields.webpackVersion` | 1/8 | 1 | `5` |  |

<details><summary>Sample 1 at +0.5s</summary>

URL: `https://telemetry.nextjs.org/api/v1/record`

```json
{
  "context": {
    "anonymousId": "e4a7…4360",
    "projectId": "1597…f2ed",
    "sessionId": "a752…40db"
  },
  "meta": {
    "systemPlatform": "darwin",
    "systemRelease": "25.6.0",
    "systemArchitecture": "arm64",
    "cpuCount": 8,
    "cpuModel": "Apple M1",
    "cpuSpeed": 2400,
    "memoryInMb": 8192,
    "isDocker": false,
    "isNowDev": false,
    "isWsl": false,
    "isCI": false,
    "ciName": null,
    "nextVersion": "16.4.2",
    "agentName": "claude-code_2-1-306_agent"
  },
  "events": [
    {
      "eventName": "NEXT_CLI_SESSION_STARTED",
      "fields": {
        "nextVersion": "16.4.2",
        "nodeVersion": "v22.23.3",
        "cliCommand": "build",
        "isSrcDir": false,
        "hasNowJson": false,
        "isCustomServer": null,
        "hasNextConfig": false,
        "buildTarget": "default",
        "hasWebpackConfig": false,
        "hasBabelConfig": false,
        "imageEnabled": true,
        "imageFutureEnabled": true,
        "basePathEnabled": false,
        "i18nEnabled": false,
        "locales": null,
        "localeDomainsCount": null,
        "localeDetectionEnabled": null,
        "imageDomainsCount": 0,
        "imageRemotePatternsCount": 0,
        "imageLocalPatternsCount": 1,
        "imageSizes": "32,48,64,96,128,256,384",
        "imageQualities": "75",
        "imageLoader": "default",
        "imageFormats": "image/webp",
        "nextConfigOutput": null,
        "trailingSlashEnabled": false,
        "reactStrictMode": false,
        "webpackVersion": 5,
        "turboFlag": true,
        "useTurbopackWorkerAssetPrefix": false,
        "isRspack": false,
        "appDir": true,
        "pagesDir": false,
        "staticStaleTime": 300,
        "dynamicStaleTime": 0,
        "reactCompiler": false,
        "reactCompilerCompilationMode": null,
        "reactCompilerPanicThreshold": null,
        "adapterPath": false
      }
    }
  ]
}
```

</details>

<details><summary>Sample 2 at +0.5s</summary>

URL: `https://telemetry.nextjs.org/api/v1/record`

```json
{
  "context": {
    "anonymousId": "e4a7…4360",
    "projectId": "1597…f2ed",
    "sessionId": "a752…40db"
  },
  "meta": {
    "systemPlatform": "darwin",
    "systemRelease": "25.6.0",
    "systemArchitecture": "arm64",
    "cpuCount": 8,
    "cpuModel": "Apple M1",
    "cpuSpeed": 2400,
    "memoryInMb": 8192,
    "isDocker": false,
    "isNowDev": false,
    "isWsl": false,
    "isCI": false,
    "ciName": null,
    "nextVersion": "16.4.2",
    "agentName": "claude-code_2-1-306_agent"
  },
  "events": [
    {
      "eventName": "NEXT_PACKAGE_DETECTED",
      "fields": {
        "packageName": "next",
        "packageVersion": "^16.4.2"
      }
    },
    {
      "eventName": "NEXT_PACKAGE_DETECTED",
      "fields": {
        "packageName": "react",
        "packageVersion": "^19.3.1"
      }
    },
    {
      "eventName": "NEXT_PACKAGE_DETECTED",
      "fields": {
        "packageName": "react-dom",
        "packageVersion": "^19.3.1"
      }
    }
  ]
}
```

</details>

### `POST registry.npmjs.org/-/npm/v1/security/advisories/bulk`

- **1 request** · first at +0.4s · last at +0.4s · ≈321 B sent
- Category: other
- Status: 200 ×1
- Body: json ×1
- User-Agent: `node`

| Field | Seen in | Distinct | Example | Notes |
|---|---:|---:|---|---|
| `next[]` | 1/1 | 1 | `16.4.2` |  |

<details><summary>Sample 1 at +0.4s</summary>

URL: `https://registry.npmjs.org/-/npm/v1/security/advisories/bulk`

```json
{
  "next": [
    "16.4.2"
  ]
}
```

</details>

---

Generated by whatleaks 0.1.0. Redacted: `‹labels›` replace local identifiers and secrets, and ids are masked. Classification marked "?" is a guess from the URL.
