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
| M5 capture core and `run` | next | |
| M6 process tree, linger, direct watcher | | |
| M7 `compare` and `opt-outs` | | |
| M8 real end to end and accuracy | | |
| M9 docs, review, summary | | |

Gate at the last commit: typecheck, lint, 97 tests.

## Next

M5: `src/capture/{ca,env,proxy,recorder,launch,session}.ts` and `src/commands/run.ts`.
Points to keep in mind:
- The proxy URL for the child is `http://127.0.0.1:PORT`. Never use mockttp's
  `server.url`, which is https and makes clients hang (RESEARCH §5).
- Force the loopback bind by wrapping `net.Server.prototype.listen` while `start()`
  runs (D-08).
- Set `NODE_USE_ENV_PROXY=1` as an env var only. Never put it in `NODE_OPTIONS`.

## Blocked

Nothing.
