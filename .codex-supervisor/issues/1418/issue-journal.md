# Issue #1418: Update sticky tracked-PR status comments on blocker changes and clear them without churn

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1418
- Branch: codex/issue-1418
- Workspace: .
- Journal: .codex-supervisor/issues/1418/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 75e102541398b89a5fa82857270e066c9fbb4931
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-04-11T01:28:53.481Z

## Latest Codex Summary
- None yet.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: Sticky tracked-PR status comments deduped repeated blocker fingerprints, but there was no same-comment update path when a previously published persistent blocker cleared on the same head.
- What changed: Added cleared-status publishing for active tracked-PR states in `handlePostTurnPullRequestTransitionsPhase`, keyed by a stable `cleared:<state>` fingerprint so the existing sticky comment updates once on recovery without repeat churn. Added focused tests for clear-on-recovery and no-churn on repeated identical cycles.
- Current blocker: none
- Next exact step: Commit the focused implementation and test changes on `codex/issue-1418`.
- Verification gap: none for the scoped change; targeted suite and issue-listed verification command are green locally.
- Files touched: `src/post-turn-pull-request.ts`, `src/post-turn-pull-request.test.ts`, `.codex-supervisor/issues/1418/issue-journal.md`
- Rollback concern: Low; behavior only changes when a sticky tracked-PR status comment already exists on the current head and the PR resumes an active state.
- Last focused command: `npx tsx --test src/post-turn-pull-request.test.ts src/recovery-reconciliation.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts src/doctor.test.ts`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
