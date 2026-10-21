# Progress

This is the resume point for any session.

Spec: `docs/superpowers/specs/2026-10-21-whatleaks-design.md`.
Plan: `docs/superpowers/plans/2026-10-21-whatleaks.md`.
Decisions: `docs/DECISIONS.md`. Research: `docs/RESEARCH.md`.

## Status

| Milestone | State | Commit |
|---|---|---|
| Research, spec, plan | done | fd12eee |
| M0 scaffold | done | 7301b37 |
| M1 HAR model, body decoding, URL templates | done | f47a67e |
| M2 analysis: fields, identity, classify, redact, report | done | 9f9727b |
| M3 renderers and the `report` command | done | a438b69 |
| Catalogs: 69 hosts and 32 opt-outs, all sourced | done | 7d5a82b |
| M4 diff and the `diff` command (`--strict`) | done | be6f148 |
| M5 capture core and `run` | done | 02446d0 |
| M6 process tree, linger, direct watcher | done | 497cc4f |
| M7 `compare` and `opt-outs` | done | fc9c14c |
| M8 real end to end and accuracy | next | |
| M9 docs, review, summary | | |

Gate at the last commit: typecheck, lint, 123 tests. Run `./scripts/gate.sh` before committing. It returns npm's real exit code, which a `| grep` pipe used to hide.

## Next

M8, real end to end:
- Scratch Next.js app in `/tmp/wl-e2e/next-app`.
- Ground truth from `NEXT_TELEMETRY_DEBUG=1` (it prints the events and sends nothing).
- `whatleaks compare` with the known opt-outs, and with `DO_NOT_TRACK` only.
- Save the outputs under `docs/e2e/`, and a scrubbed HAR under `test/fixtures/real/`.

## Blocked

Nothing.
