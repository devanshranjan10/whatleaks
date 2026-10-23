# Contributing

```sh
npm ci
npm run build
npm run check     # typecheck, lint, tests: offline; integration tests use loopback servers only
```

- **Tests never touch the network.** They use recorded fixtures (`test/fixtures/`,
  including scrubbed captures of real `next build` runs) and local servers.
- **Decisions go in `docs/DECISIONS.md`**, numbered, each with its reason. A claim about
  accuracy needs a measurement in `docs/BENCHMARK.md` or `docs/ACCURACY.md`.
- **Adding a telemetry endpoint** (the most useful contribution): add an entry to
  `src/catalog/hosts.ts` with the host, a path if the host also serves ordinary content,
  the vendor, a category and a public source: the vendor's docs, or the tool's own
  source pinned to a commit. `test/catalog.test.ts` checks every entry.
- **Adding an opt-out variable:** `src/catalog/optouts.ts`, with the documented value,
  the tools that read it and its source. `compare` sets every variable in that list in
  its second run, so add only variables documented to turn telemetry (or a named kind of
  traffic) off.
- **Reporting what a tool sends:** open an issue with the command, the tool's version and
  the report (`--md report.md`). Read the report before you post it; redaction is
  pattern-based. Never attach the HAR file: it holds the raw traffic.
- **Benchmark scenarios** live in `bench/lab/` (`scenarios.ts`; each client writes every
  attempt to a ledger before making it). `bench/run-lab.ts` runs them and
  `bench/summarize.ts` scores the results. See `docs/BENCHMARK.md` for the method.
- **Security issues:** see [SECURITY.md](SECURITY.md).
