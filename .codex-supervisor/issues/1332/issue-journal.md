# Issue #1332: Clarify prompt and status surfaces for same-PR local-review follow-up repair

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1332
- Branch: codex/issue-1332
- Workspace: .
- Journal: .codex-supervisor/issues/1332/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 0fc40256f52a8fd558a29e2c804c9d0bd13254ef
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-04-07T13:00:07.255Z

## Latest Codex Summary
- None yet.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: `local_review_fix` was hiding whether the repair pass came from same-PR `follow_up_eligible` residuals or a high-severity retry, so prompt and operator status surfaces needed an explicit repair-intent marker without changing the saved pre-merge outcome.
- What changed: Added prompt-side `repairIntent` wording for local-review repair context, annotated turn-prep repair context from the live record, extended pre-merge evaluation rendering with `repair=...`, and tightened focused tests for prompt, explain, active-status snapshot, and status-summary output.
- Current blocker: none.
- Next exact step: Commit the verified checkpoint on `codex/issue-1332`.
- Verification gap: none for the scoped prompt/status change; targeted tests and `npm run build` passed locally.
- Files touched: `src/codex/codex-prompt.ts`, `src/codex/codex-prompt.test.ts`, `src/supervisor/supervisor-pre-merge-evaluation.ts`, `src/supervisor/supervisor-selection-issue-explain.test.ts`, `src/supervisor/supervisor-selection-status-active-status.test.ts`, `src/supervisor/supervisor-status-rendering-supervisor.test.ts`, `src/turn-execution-orchestration.ts`, `src/turn-execution-orchestration.test.ts`.
- Rollback concern: low; changes are additive wording/metadata surfaces and test coverage around existing follow-up repair routing.
- Last focused command: `npm run build`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
