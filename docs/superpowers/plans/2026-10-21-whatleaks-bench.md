# whatleaks benchmark: plan

**Spec:** `docs/superpowers/specs/2026-10-21-whatleaks-bench-design.md`. Execution is
inline. The gate is unchanged: `./scripts/gate.sh` before every commit.

| Step | Output | Done when |
|---|---|---|
| B1 Scorer + tests | `bench/lab/score.ts`, `test/bench-score.test.ts` | outcomes for payload/request/host/missed and false attributions are unit-tested |
| B2 Lab server + clients + scenarios | `bench/lab/*` | every scenario runs once by hand and writes a ledger |
| B3 Lab runner, whatleaks + mitmproxy | `bench/run-lab.ts`, `bench/results/lab-before.*` | baseline numbers on the current build |
| B4 Perf runner | `bench/run-perf.ts`, `bench/results/perf-before.*` | startup, latency, throughput, RSS |
| F1 netstat direct watcher | `src/capture/netstat.ts`, observer wiring, tests | lab direct scenarios re-run |
| F2 Java proxy + truststore | `src/capture/java.ts`, env wiring, tests | Java scenario re-run |
| F3 short-lived child attribution, late helpers | observer changes, tests | lifecycle scenarios re-run |
| B5 Lab + perf after fixes | `bench/results/lab-after.*`, `perf-after.*` | numbers compared, regressions explained |
| B6 Real-tool corpus + baselines | `bench/real/*`, `bench/run-real.ts`, results | each tool scored |
| B7 Real HAR imports, Linux in Docker | fixtures, tests, results | pass or a named limit |
| B8 Docs | `docs/BENCHMARK.md`, ACCURACY, README, PROGRESS | numbers match the result files |
| B9 Independent review | fixes for every confirmed finding | gate green |

Commit after each step that changes code, with the before/after numbers in the message
where a fix moved one.
