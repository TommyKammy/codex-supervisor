# Issue #718: JSON corruption fail-closed: block execution-changing commands until explicit recovery

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/718
- Branch: codex/issue-718
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: stabilizing
- Attempt count: 2 (implementation=2, repair=0)
- Last head SHA: 5fbd12630f8e60ed3feef1b3b56e6b3d3e4a9eed
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-20T15:09:39.000Z

## Latest Codex Summary
- Added a narrow fail-closed gate for quarantined JSON state: `runOnce()` now returns a deterministic operator-facing block reason before auth/reconciliation, `runRecoveryAction("requeue")` rejects while the JSON quarantine marker is present, and the supervisor runtime stops `loop` immediately when that fail-closed message is returned. Focused corruption regressions passed, then the issue verification set and `npm run build` passed after restoring local dev dependencies with `npm install`.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the remaining fail-open gap lives above the JSON loader, so the narrow safe fix is to treat the loader’s quarantine marker plus JSON `load_findings` as an execution-changing command block while leaving status/doctor/reset available.
- What changed: added focused regressions proving `runOnce()` continued into issue-selection, `requeue` still mutated against the forced-empty fallback, and `loop` would keep sleeping after a fail-closed message. Implemented a narrow supervisor-level JSON corruption gate that only activates for the JSON backend when the state contains the exact quarantine marker/finding combination; `runOnce()` now returns a deterministic fail-closed reason before auth/reconciliation, `runRecoveryAction("requeue")` returns a rejected DTO with that same reason, and `runSupervisorCommand(...loop...)` stops immediately instead of spinning.
- Current blocker: none
- Next exact step: stage the fail-closed supervisor/runtime/test/journal changes, commit the checkpoint, and then decide whether to open/update a draft PR for issue #718.
- Verification gap: none locally after `npx tsx --test src/core/state-store.test.ts src/cli/supervisor-runtime.test.ts src/supervisor/supervisor.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts` and `npm run build`.
- Files touched: `src/cli/supervisor-runtime.ts`, `src/cli/supervisor-runtime.test.ts`, `src/supervisor/supervisor.ts`, `src/supervisor/supervisor-diagnostics-status-selection.test.ts`, `.codex-supervisor/issue-journal.md`
- Rollback concern: reverting this patch reopens the fail-open path where quarantined JSON state is treated as usable supervisor state, allowing `run-once`, `loop`, and operator requeue mutations to act on the forced-empty fallback before the operator intentionally recovers.
- Last focused command: `npm run build`
- Last focused commands: `sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-718/AGENTS.generated.md`; `sed -n '1,260p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-718/context-index.md`; `sed -n '1,320p' .codex-supervisor/issue-journal.md`; `git status --short`; `rg -n "reset-corrupt-json-state|json_state_quarantine|load_findings|run-once|loop|status|doctor|corrupt" src`; `sed -n '1,260p' src/cli/supervisor-runtime.test.ts`; `sed -n '1,260p' src/cli/supervisor-runtime.ts`; `sed -n '1,260p' src/supervisor/supervisor.ts`; `sed -n '1,260p' src/supervisor/supervisor-diagnostics-status-selection.test.ts`; `sed -n '1,260p' src/run-once-cycle-prelude.ts`; `sed -n '1,380p' src/core/state-store.ts`; `sed -n '1,260p' src/supervisor/supervisor-test-helpers.ts`; `npx tsx --test src/cli/supervisor-runtime.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts`; `npx tsx --test src/core/state-store.test.ts src/cli/supervisor-runtime.test.ts src/supervisor/supervisor.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts`; `npm run build`; `npm install`; `npm run build`; `git diff -- src/cli/supervisor-runtime.ts src/cli/supervisor-runtime.test.ts src/supervisor/supervisor.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts .codex-supervisor/issue-journal.md`; `date -u +"%Y-%m-%dT%H:%M:%S.000Z"`; `git rev-parse HEAD`
### Scratchpad
- 2026-03-21 (JST): Added focused fail-closed regressions for quarantined JSON state, reproduced that `runOnce()` still reached issue selection, `requeue` still mutated against the forced-empty fallback, and `loop` kept sleeping after a fail-closed result, then implemented a narrow supervisor/runtime gate that blocks execution-changing commands until `reset-corrupt-json-state` and reran the issue verification plus `npm run build` successfully after `npm install`.
- 2026-03-20 (JST): Added a focused status regression for invalid JSON state, reproduced the omission where status only printed normal empty-state lines, then appended explicit `state_diagnostic` and `state_load_finding` lines for JSON `load_findings` so corruption is visible in status without changing loader semantics.
- 2026-03-20 (JST): Added a focused docs regression for the missing JSON corruption contract, confirmed the new assertion failed first, then updated the English operator docs so they consistently say corrupted JSON state is a recovery event requiring explicit acknowledgement/reset and `status`/`doctor` triage before reuse.
- 2026-03-19 (JST): Addressed CodeRabbit thread `PRRT_kwDORgvdZ851N_xt` by guarding replay corpus case-id suggestion derivation in `src/index.ts`; focused verification passed with `npx tsx --test src/index.test.ts` and `npm run build`.
- 2026-03-19 (JST): Added focused parser coverage for `replay-corpus-promote` plus an end-to-end CLI promotion regression in `src/index.test.ts`; the initial missing behavior was that the CLI had no dedicated promotion entry path at all.
- 2026-03-19 (JST): Implemented `replay-corpus-promote` in `src/index.ts` and extended `CliOptions` in `src/core/types.ts` with explicit `caseId` support; the new CLI path uses the existing `promoteCapturedReplaySnapshot(...)` implementation and defaults `corpusPath` to checked-in `replay-corpus`.
- 2026-03-19 (JST): Focused verification passed with `npx tsx --test src/index.test.ts src/supervisor/replay-corpus.test.ts`; `npm run build` first failed because `tsc` was missing locally, so ran `npm install` and reran `npm run build` successfully.
- 2026-03-19 (JST): Added `suggestReplayCorpusCaseIds(...)` with deterministic issue/state and normalized-title candidates, plus focused helper coverage in `src/supervisor/replay-corpus.test.ts`.
- 2026-03-19 (JST): Relaxed `parseArgs(...)` so `replay-corpus-promote <snapshotPath>` reaches `main()`, where the CLI now loads the snapshot and prints suggested case ids instead of failing before operators can see naming guidance.
