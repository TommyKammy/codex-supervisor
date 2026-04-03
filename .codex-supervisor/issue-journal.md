# Issue #1284: [codex] Make repeated-failure stop less blunt for tracked PR repair lanes

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1284
- Branch: codex/issue-1284
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: f0c4370e9edb176c38fdb3861cf72eac18e41faa
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-04-03T10:01:46.142Z

## Latest Codex Summary
- None yet.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: Repeated identical tracked-PR failures should only terminally stop when authoritative tracked PR facts have not advanced since the prior occurrence; PR head/check/review lifecycle progress should keep the lane retryable.
- What changed: Added tracked PR progress snapshot/decision fields on run records, taught the supervisor repeated-failure gate to suppress the blunt stop when tracked PR progress advanced, and surfaced the decision in explain output. Added a focused orchestration regression and explain coverage. Committed as `604db04` and opened draft PR #1285.
- Current blocker: none
- Next exact step: Let CI run on draft PR #1285 and continue supervisor verification against the narrowed tracked-PR stop policy if review or checks surface follow-up work.
- Verification gap: No additional gap after the focused issue verification set and `npm run build`.
- Files touched: .codex-supervisor/issue-journal.md; src/core/types.ts; src/pull-request-state-test-helpers.ts; src/supervisor/supervisor-execution-orchestration.test.ts; src/supervisor/supervisor-lifecycle.ts; src/supervisor/supervisor-selection-issue-explain.test.ts; src/supervisor/supervisor-selection-issue-explain.ts; src/supervisor/supervisor-test-helpers.ts; src/supervisor/supervisor.ts
- Rollback concern: The new suppression path is intentionally scoped to tracked PR lanes; if the progress snapshot proves too permissive, the main rollback point is the tracked PR progress signal set in `src/supervisor/supervisor-lifecycle.ts`.
- Last focused command: npx tsx --test src/supervisor/supervisor-execution-policy.test.ts src/supervisor/supervisor-recovery-reconciliation.test.ts src/supervisor/supervisor-execution-orchestration.test.ts src/run-once-cycle-prelude.test.ts src/supervisor/supervisor-diagnostics-explain.test.ts
### Scratchpad
- `npm run build` passed after making `trackedPrRetryabilitySummary` optional for existing DTO test doubles.
