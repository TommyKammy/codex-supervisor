# Issue #1454: Preserve original runtime failure context across no-PR manual-review recovery

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1454
- Branch: codex/issue-1454
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 1f70eca4fc7d3691c7506fe116a78147172c0748
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-04-12T06:37:39.674Z

## Latest Codex Summary
- None yet.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: Failed no-PR reconciliation was replacing `last_failure_*` with a generic manual-review blocker, and older failed records without populated `last_runtime_*` lost the original `codex_exit` context entirely. `explain` also only surfaced the blocker summary.
- What changed: Added a fallback snapshot in `src/recovery-no-pr-reconciliation.ts` so failed no-PR manual-review reconciliation copies the pre-reconciliation runtime failure into `last_runtime_*` when those fields are empty before replacing `last_failure_*`. Extended `src/supervisor/supervisor-selection-issue-explain.ts` to emit `runtime_failure_kind` and `runtime_failure_summary`. Added regression coverage in the recovery reconciliation and explain test files.
- Current blocker: none
- Next exact step: Commit the checkpoint on `codex/issue-1454`, then open or update a draft PR if needed by the supervisor loop.
- Verification gap: `npm test -- ...` still expands to the broader suite and hits an unrelated existing failure in `local CI browser helpers summarize a repo-owned candidate contract consistently`; isolated `npx tsx --test` runs for the touched test files passed, and `npm run build` passed.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/recovery-no-pr-reconciliation.ts`, `src/supervisor/supervisor-selection-issue-explain.ts`, `src/supervisor/supervisor-recovery-reconciliation.test.ts`, `src/supervisor/supervisor-diagnostics-explain.test.ts`
- Rollback concern: low; change is scoped to failed no-PR manual-review reconciliation and explain rendering, but reverting would again hide original runtime failure details for older failed records that lack `last_runtime_*`.
- Last focused command: `npm run build`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
