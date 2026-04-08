# Issue #1361: Refactor: extract run-once orchestration from supervisor.ts

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1361
- Branch: codex/issue-1361
- Workspace: .
- Journal: .codex-supervisor/issues/1361/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 6c057f4a282cebcd63475982cc805828111eab63
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-04-08T22:40:35.924Z

## Latest Codex Summary
- Extracted the top-level run-once restart loop and issue-phase progression into `src/supervisor/supervisor-run-once-runtime.ts`, leaving `Supervisor` as a thin dependency/wiring layer.
- Added a focused runtime test for carryover recovery events across restart cycles and re-ran the issue-targeted runtime/build verification.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: `Supervisor.runOnce()` can delegate orchestration safely if the restart loop and issue-phase handoff contract are extracted behind a runtime module with callback-based dependencies.
- What changed: Added `src/supervisor/supervisor-run-once-runtime.ts` and `src/supervisor/supervisor-run-once-runtime.test.ts`; rewired `src/supervisor/supervisor.ts` so `runOnce()` and `runOnceIssuePhase()` delegate to the runtime module while preserving existing helper methods and behavior.
- Current blocker: none
- Next exact step: Commit the extracted runtime module and focused test checkpoint on `codex/issue-1361`.
- Verification gap: none for the scoped issue verification set; broader unrelated test suites were not run.
- Files touched: `.codex-supervisor/issues/1361/issue-journal.md`, `src/supervisor/supervisor.ts`, `src/supervisor/supervisor-run-once-runtime.ts`, `src/supervisor/supervisor-run-once-runtime.test.ts`
- Rollback concern: low; behavior is preserved through existing orchestration tests plus the new focused runtime test, but the runtime module now owns callback contracts used by `Supervisor`.
- Last focused command: `npx tsx --test src/run-once-cycle-prelude.test.ts src/run-once-turn-execution.test.ts src/run-once-issue-selection.test.ts src/cli/supervisor-runtime.test.ts src/supervisor/supervisor-run-once-runtime.test.ts`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
