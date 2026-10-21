# whatleaks: implementation plan

**Spec:** `docs/superpowers/specs/2026-10-21-whatleaks-design.md`

**Execution:** inline, by the session that wrote the spec. The owner pre-approved the
method; the writing-plans skill is not installed (D-02).

## The gate for every milestone

```
npm run typecheck && npm run lint && npm test
```

All three must pass before committing. Commit messages use `feat(scope): …`,
`test: …` and `docs: …`, with the Co-Authored-By trailer. Update
`docs/PROGRESS.md` after every commit.

## Conventions

- **TypeScript.**
  - Strict mode, with `noUncheckedIndexedAccess`.
  - ESM, NodeNext, and `.js` suffixes on relative imports.
- **Pure analysis.** Nothing under `src/analyze`, `src/diff`, `src/render` or
  `src/har/read` does I/O.
  - The identity source is injected.
  - Clocks are injected wherever time matters.
- **Offline tests.**
  - `test/setup.ts` makes `globalThis.fetch` throw for any non-loopback URL.
  - Integration tests use only 127.0.0.1 servers.
- **Fixtures** live in `test/fixtures/`. Hand-built synthetic HARs are named
  `synthetic-*.har`; scrubbed recordings of real runs go in `real/`.

---

## M0: Scaffold

**Files:**
- `package.json`:
  - name `whatleaks`, bin `whatleaks`, `type: module`, engines `>=22.12`
  - scripts: build, typecheck, lint, test, check
- `tsconfig.json`, `tsup.config.ts`, `eslint.config.js`, `vitest.config.ts`,
  `test/setup.ts`, `.gitignore`, `LICENSE` (MIT)
- `src/cli.ts` (commander, `--version`), `src/version.ts`

**Dependencies:** commander, picocolors, mockttp. Dev: typescript, tsup, vitest,
eslint, typescript-eslint, @types/node, tsx.

**Tests:** after the build, `node dist/cli.js --version` prints the package version.

**Commit:** `chore: scaffold whatleaks package`

## M1: HAR model, body decoding, URL templates

**Files:**
- `src/har/types.ts`: HAR 1.2 types plus the `_whatleaks` extensions
  (`SessionMeta`, `RefusedHost`, `DirectConn`, `PassthroughHost`).
- `src/har/read.ts`: `parseHar(text): Capture`, tolerant of other tools' HAR.
  - Request bodies come from `postData.text`, with `_encoding` or `encoding: base64`
    honoured, or from `postData.params`.
  - Reports a clear error that names the field.
- `src/har/write.ts`: `serializeHar(capture)`, plus `writeHarFile(path, text)` (mode
  0600).
- `src/analyze/body.ts`: `decodeBody(bytes, contentType, contentEncoding)` returns
  `{ format, text?, json?, strings?, size }`.
  - Formats: json, ndjson, form, text, binary.
  - Detects gzip by magic bytes even without a header.
- `src/analyze/url.ts`: `templatePath(path)` and `queryParamNames(url)`.

**Tests:** `har-read.test.ts` (fixtures for whatleaks HAR, Chrome-style HAR and
mitmproxy-style HAR), `body.test.ts`, `url.test.ts`.

**Commit:** `feat(har): HAR model, tolerant reader, body decoding, path templates`

## M2: Analysis

**Files:**
- `src/analyze/fields.ts`: `flatten(json)` gives path/value leaves (`[]` for
  arrays, depth 8, at most 500 leaves). `FieldStats` accumulates across requests.
- `src/analyze/identity.ts`:
  - `IdentitySource` interface, plus `localIdentitySource()` (os, ioreg,
    machine-id and git config; each one fails soft).
  - `buildMatchers(identities)` expands each identifier into variants and hashes.
  - `findIdentity(text)` returns matches.
  - Generic detectors: email, absolute path, id-shaped value.
- `src/analyze/classify.ts` and `src/catalog/hosts.ts`.
- `src/analyze/redact.ts`: redacts headers, query, JSON and strings.
- `src/analyze/report.ts`: `buildReport(capture, opts)` returns `Report`. Options:
  identities, samples, raw.

**Tests:** one test file per unit, plus `report.test.ts` against
`synthetic-chatty.har`, built to cover every finding kind.

**Commit:** `feat(analyze): report model with fields, identity findings, classification, redaction`

## M3: Renderers and `report`

**Files:** `src/render/terminal.ts`, `src/render/markdown.ts`,
`src/render/json.ts`, `src/render/format.ts` (bytes, durations, sparkline, table),
and `src/commands/report.ts`.

**Tests:** golden files under `test/golden/`, written with `toMatchFileSnapshot`.
Colors are off in tests. A CLI test runs `report` on a fixture.

**Commit:** `feat(render): terminal, markdown and JSON reports; report command`

## M4: Diff

**Files:** `src/diff/diff.ts` (`buildDiff(before, after)`), the diff sections in
both renderers, and `src/commands/diff.ts` (`--strict`).

**Tests:** `diff.test.ts` with fixture pairs covering still, stopped and new
endpoints, persistent values and field changes. Golden files. A CLI exit-code test
for `--strict`.

**Commit:** `feat(diff): before/after diff with persistent identifiers and --strict`

## M5: Capture core and `run`

**Files:**
- `src/capture/ca.ts`, `src/capture/env.ts`
- `src/capture/proxy.ts`: loopback bind and the event-to-recorder wiring
- `src/capture/recorder.ts`, `src/capture/launch.ts`, `src/capture/session.ts`
- `src/commands/run.ts`

**Tests:**
- `env.test.ts` (pure).
- `recorder.test.ts`, which feeds fake mockttp events.
- `capture.integration.test.ts`:
  - local HTTP and HTTPS upstreams, with the test CA passed as
    `additionalTrustedCAs`
  - children: node fetch and node https, plus curl and python3 when present
  - the HAR contains the bodies
  - the refused-TLS case
  - the loopback-only bind
  - exit code passthrough
  - `--duration`

**Commit:** `feat(capture): loopback proxy with ephemeral CA, launcher, run command`

## M6: Process tree, linger and direct watcher

**Files:** `src/capture/proctree.ts` (ps parser and tracker), `src/capture/direct.ts`
(lsof `-F` parser and sampler), linger and idle handling in `session.ts`, and the
report sections for "not visible".

**Tests:** parser tests on recorded `ps` and `lsof` output fixtures. Integration
tests:
- a detached grandchild that sends after the parent exits is captured
- a child that ignores the proxy and connects directly to a local non-loopback
  listener (if available) is listed under direct connections

**Commit:** `feat(capture): process tree tracking, linger for stragglers, direct-connection watcher`

## M7: Opt-outs and `compare`

**Files:** `src/catalog/optouts.ts` (verified entries with sources),
`src/commands/compare.ts`, `src/commands/optouts.ts`, and `--opt-out` on `run`.

**Tests:** catalog integrity (every entry has a source URL and a valid env name). A
compare integration test against a local fake tool that honours `DO_NOT_TRACK` for
one endpoint but not another.

**Commit:** `feat(compare): scripted on/off runs with documented opt-out variables`

## M8: Real end to end and accuracy

- Run `compare` on at least one real dev CLI from the research shortlist. Save the
  output under `docs/e2e/`.
- Scrub one real capture into `test/fixtures/real/` and add regression tests.
- Use the tool's own local debug output as ground truth where it exists.
- Hand-label the classification. Write `docs/ACCURACY.md`.

**Commit:** `test(e2e): real runs, recorded fixtures, accuracy report`

## M9: Docs, review, summary

- README: install, usage, example output (copied from a real run), limitations,
  accuracy.
- An independent code-review pass, with fixes.
- A fresh-clone gate: `npm ci`, check and build.
- A morning summary in PROGRESS.md.

**Commit:** `docs: README, accuracy, morning summary`
