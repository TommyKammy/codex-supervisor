# Issue #1175: Broaden bounded fail-soft continuation for transient full-inventory failures

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1175
- Branch: codex/issue-1175
- Workspace: .
- Journal: .codex-supervisor/issues/1175/issue-journal.md
- Current phase: stabilizing
- Attempt count: 2 (implementation=2, repair=0)
- Last head SHA: 0d66e5a751c73a5f338081114f40ff855fc59e8d
- Blocked reason: none
- Last failure signature: stale-stabilizing-no-pr-recovery-loop
- Repeated failure signature count: 0
- Updated at: 2026-03-28T14:45:14.582Z

## Latest Codex Summary
Implemented the bounded transient fail-soft policy and checkpointed it in commit `0d66e5a`.

The change persists a `bounded_continuation_allowed` bit on `inventory_refresh_failure`, derives it only for the first transient full-inventory failure with a fresh snapshot, and reuses that policy in both [src/run-once-cycle-prelude.ts](src/run-once-cycle-prelude.ts) and [src/run-once-issue-selection.ts](src/run-once-issue-selection.ts). That keeps existing malformed/rate-limit degraded continuation behavior intact, but hard-blocks repeated transient continuation for tracked PR reconciliation and active issue progress. I also added targeted regressions in [src/run-once-cycle-prelude.test.ts](src/run-once-cycle-prelude.test.ts), [src/run-once-issue-selection.test.ts](src/run-once-issue-selection.test.ts), and persistence coverage in [src/core/state-store.test.ts](src/core/state-store.test.ts). The issue journal was updated at [.codex-supervisor/issues/1175/issue-journal.md](.codex-supervisor/issues/1175/issue-journal.md).

Verification passed with:
`npm exec --yes -- tsx --test src/core/state-store.test.ts src/run-once-cycle-prelude.test.ts src/run-once-issue-selection.test.ts src/supervisor/supervisor-pr-review-blockers.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts`

Type-check verification was not cleanly runnable here via ad hoc `npm exec` because the worktree does not have local Node type deps installed and `tsconfig.json` currently trips a TS 6 deprecation error under that path.

Summary: Persisted bounded transient inventory fail-soft state, blocked repeated transient continuation for tracked PR reconciliation and active issue progress, added focused regressions, updated the issue journal, and committed as `0d66e5a`.
State hint: stabilizing
Blocked reason: none
Tests: `npm exec --yes -- tsx --test src/core/state-store.test.ts src/run-once-cycle-prelude.test.ts src/run-once-issue-selection.test.ts src/supervisor/supervisor-pr-review-blockers.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts`; `npm exec --yes --package typescript -- tsc -p tsconfig.json --noEmit` failed due missing `@types/node` and a TS 6 `moduleResolution=node10` deprecation error
Next action: Open or update a draft PR for branch `codex/issue-1175`, or continue with any review-driven follow-up if the supervisor requests broader verification
Failure signature: stale-stabilizing-no-pr-recovery-loop

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: Repeated transient full-inventory refresh failures were still flowing through degraded tracked-PR reconciliation and degraded active-issue continuation because only snapshot-backed new selection was bounded by first-failure tolerance.
- What changed: Added a persisted `bounded_continuation_allowed` bit on `inventory_refresh_failure`, derived it only for first transient failures with a fresh snapshot, reused that state in shared inventory-refresh policy helpers, hard-blocked exhausted transient continuation in `runOnceCyclePrelude` and `resolveRunnableIssueContext`, and added regression coverage plus state-store roundtrip coverage.
- Current blocker: none
- Next exact step: Monitor draft PR #1179 for CI and review feedback, then address any follow-up on `codex/issue-1175`.
- Verification gap: none for the focused issue checks; broader full-suite coverage remains unrun.
- Files touched: .codex-supervisor/issues/1175/issue-journal.md; src/core/types.ts; src/core/state-store.ts; src/core/state-store.test.ts; src/inventory-refresh-state.ts; src/run-once-cycle-prelude.ts; src/run-once-cycle-prelude.test.ts; src/run-once-issue-selection.ts; src/run-once-issue-selection.test.ts
- Rollback concern: Low to moderate; the main policy risk is over-blocking degraded continuation if future callers expect repeated transient failures to keep using the prior fail-soft path without a fresh bounded allowance.
- Last focused command: gh pr create --draft --base main --head codex/issue-1175 --title "[codex] Broaden bounded fail-soft continuation for transient full-inventory failures" --body ...
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
- 2026-03-28: Re-ran focused regression coverage with `npm exec --yes -- tsx --test src/core/state-store.test.ts src/run-once-cycle-prelude.test.ts src/run-once-issue-selection.test.ts src/supervisor/supervisor-pr-review-blockers.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts` and all 100 tests passed.
- 2026-03-28: Installed locked dev dependencies with `npm ci`, then verified `./node_modules/.bin/tsc -p tsconfig.json --noEmit` passes cleanly in-worktree.
- 2026-03-28: Pushed `codex/issue-1175` to `github` and opened draft PR #1179: https://github.com/TommyKammy/codex-supervisor/pull/1179
