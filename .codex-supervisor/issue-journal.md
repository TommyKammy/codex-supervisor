# Issue #715: JSON corruption diagnostics: surface hard corruption findings in doctor and status

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/715
- Branch: codex/issue-715
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: draft_pr
- Attempt count: 2 (implementation=2, repair=0)
- Last head SHA: 008d8470e716dd6fa31ba8deda0ebf0d5c736b5e
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-20T12:16:36.360Z

## Latest Codex Summary
Added explicit JSON corruption status diagnostics in [`src/supervisor/supervisor.ts`](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-715/src/supervisor/supervisor.ts) and locked it down with a focused regression in [`src/supervisor/supervisor-diagnostics-status-selection.test.ts`](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-715/src/supervisor/supervisor-diagnostics-status-selection.test.ts). `status` now emits a hard `state_diagnostic ... corrupted_json_state_forced_empty_fallback_not_missing_bootstrap` line plus `state_load_finding ...` details when JSON state parsing falls back to empty state, while leaving execution behavior unchanged. I also updated the issue journal and committed the checkpoint as `008d847` (`status: surface JSON corruption diagnostics`).

Verification passed after installing local dev dependencies: `npx tsx --test src/core/state-store.test.ts src/doctor.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts` and `npm run build`.

Summary: Added explicit hard JSON corruption diagnostics to `status`, covered by a focused regression, and committed the checkpoint as `008d847`.
State hint: implementing
Blocked reason: none
Tests: `npx tsx --test src/core/state-store.test.ts src/doctor.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts`; `npm run build`
Failure signature: none
Next action: monitor draft PR #741 CI and address any review feedback or failures

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the narrowest safe implementation is to keep `StateStore.load()` behavior unchanged, add one focused status regression for invalid JSON, and surface the existing `load_findings` in `status` as explicit hard diagnostics distinct from missing-state bootstrap.
- What changed: added `status surfaces corrupted JSON state as an explicit hard diagnostic` in `src/supervisor/supervisor-diagnostics-status-selection.test.ts`, confirmed it failed because status only printed `No active issue.` plus tracked-record lines, then updated `src/supervisor/supervisor.ts` to append `state_diagnostic severity=hard backend=json summary=corrupted_json_state_forced_empty_fallback_not_missing_bootstrap ...` and matching `state_load_finding ...` lines whenever JSON `load_findings` are present. Doctor/state-store behavior stayed unchanged; after `npm install` restored local dev dependencies, the focused verification set and `npm run build` both passed.
- Current blocker: none
- Next exact step: monitor draft PR #741 (`https://github.com/TommyKammy/codex-supervisor/pull/741`) and address any CI or review feedback.
- Verification gap: none locally after `npx tsx --test src/core/state-store.test.ts src/doctor.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts` and `npm run build`.
- Files touched: `src/supervisor/supervisor.ts`, `src/supervisor/supervisor-diagnostics-status-selection.test.ts`, `.codex-supervisor/issue-journal.md`
- Rollback concern: reverting this checkpoint would hide corrupted JSON state from `status`, pushing operators back to ambiguous empty-state-looking output until later fail-closed changes land.
- Last focused command: `npm run build`
- Last focused commands: `sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-715/AGENTS.generated.md`; `sed -n '1,260p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-715/context-index.md`; `sed -n '1,260p' .codex-supervisor/issue-journal.md`; `sed -n '1,260p' src/core/state-store.test.ts`; `sed -n '1,260p' src/doctor.test.ts`; `sed -n '1,260p' src/supervisor/supervisor-diagnostics-status-selection.test.ts`; `sed -n '1,280p' src/doctor.ts`; `sed -n '1,340p' src/supervisor/supervisor.ts`; `sed -n '1,320p' src/core/state-store.ts`; `rg -n "load_findings|state_load_finding|state_file|statusReport|warning|corruption|parse_error|loadStateReadonlyForDoctor" src/doctor.ts src/supervisor/supervisor.ts src/core/state-store.ts src/core/types.ts`; `npx tsx --test src/supervisor/supervisor-diagnostics-status-selection.test.ts`; `npx tsx --test src/doctor.test.ts src/core/state-store.test.ts`; `npx tsx --test src/core/state-store.test.ts src/doctor.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts`; `npm install`; `npm run build`; `date -Iseconds`
### Scratchpad
- 2026-03-20 (JST): Re-ran the focused verification set plus `npm run build`, pushed `codex/issue-715` to `origin/codex/issue-715`, and opened draft PR #741 (`status: surface JSON corruption diagnostics`).
- 2026-03-20 (JST): Added a focused status regression for invalid JSON state, reproduced the omission where status only printed normal empty-state lines, then appended explicit `state_diagnostic` and `state_load_finding` lines for JSON `load_findings` so corruption is visible in status without changing loader semantics.
- 2026-03-20 (JST): Added a focused docs regression for the missing JSON corruption contract, confirmed the new assertion failed first, then updated the English operator docs so they consistently say corrupted JSON state is a recovery event requiring explicit acknowledgement/reset and `status`/`doctor` triage before reuse.
- 2026-03-19 (JST): Addressed CodeRabbit thread `PRRT_kwDORgvdZ851N_xt` by guarding replay corpus case-id suggestion derivation in `src/index.ts`; focused verification passed with `npx tsx --test src/index.test.ts` and `npm run build`.
- 2026-03-19 (JST): Added focused parser coverage for `replay-corpus-promote` plus an end-to-end CLI promotion regression in `src/index.test.ts`; the initial missing behavior was that the CLI had no dedicated promotion entry path at all.
- 2026-03-19 (JST): Implemented `replay-corpus-promote` in `src/index.ts` and extended `CliOptions` in `src/core/types.ts` with explicit `caseId` support; the new CLI path uses the existing `promoteCapturedReplaySnapshot(...)` implementation and defaults `corpusPath` to checked-in `replay-corpus`.
- 2026-03-19 (JST): Focused verification passed with `npx tsx --test src/index.test.ts src/supervisor/replay-corpus.test.ts`; `npm run build` first failed because `tsc` was missing locally, so ran `npm install` and reran `npm run build` successfully.
- 2026-03-19 (JST): Added `suggestReplayCorpusCaseIds(...)` with deterministic issue/state and normalized-title candidates, plus focused helper coverage in `src/supervisor/replay-corpus.test.ts`.
- 2026-03-19 (JST): Relaxed `parseArgs(...)` so `replay-corpus-promote <snapshotPath>` reaches `main()`, where the CLI now loads the snapshot and prints suggested case ids instead of failing before operators can see naming guidance.
