# Issue #1365: Refactor: extract pull-request state sync helpers from pull-request-state.ts

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1365
- Branch: codex/issue-1365
- Workspace: .
- Journal: .codex-supervisor/issues/1365/issue-journal.md
- Current phase: addressing_review
- Attempt count: 3 (implementation=2, repair=1)
- Last head SHA: 438f7abd18e7f0c44c00d083e4d6652965abc7c7
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ855tp-Y
- Repeated failure signature count: 1
- Updated at: 2026-04-09T00:17:33.577Z

## Latest Codex Summary
Validated the unresolved CodeRabbit thread on PR [#1372](https://github.com/TommyKammy/codex-supervisor/pull/1372) and confirmed the review comment was correct: `syncCopilotReviewRequestObservation` preserved a stale same-head observation even after `copilotReviewState` fell back to `not_requested`.

Implemented a minimal fix in `src/pull-request-state-sync.ts` so same-head request observations are only preserved while the PR still reports `requested`, and added a regression test in `src/pull-request-state-sync.test.ts` that proves the stale state is cleared once the request disappears. The worktree still includes untracked supervisor runtime artifacts under `.codex-supervisor/`, which I left out of scope.

Summary: Fixed the PR #1372 review thread by clearing stale same-head Copilot request observations and added regression coverage for the `not_requested` transition.
State hint: addressing_review
Blocked reason: none
Tests: `npx tsx --test src/pull-request-state-sync.test.ts`; `npx tsx --test src/pull-request-state-policy.test.ts src/review-handling.test.ts src/supervisor/supervisor-pre-merge-evaluation.test.ts`; `npm run build`
Next action: Commit and push the review fix to `codex/issue-1365`, then monitor PR #1372 for refreshed CI and thread state
Failure signature: none

## Active Failure Context
- Category: review
- Summary: 1 unresolved automated review thread(s) remain.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/1372#discussion_r3054845217
- Details:
  - src/pull-request-state-sync.ts:66 summary=_⚠️ Potential issue_ | _🟠 Major_ **Clear stale Copilot request observations once the PR is no longer in the requested state.** This same-head preserve branch runs before the `"... url=https://github.com/TommyKammy/codex-supervisor/pull/1372#discussion_r3054845217

## Codex Working Notes
### Current Handoff
- Hypothesis: The sync-helper extraction remains behavior-safe as long as request-state persistence only survives while GitHub still reports `copilotReviewState: "requested"` for the current head.
- What changed: Tightened `syncCopilotReviewRequestObservation` in `src/pull-request-state-sync.ts` so same-head observations are preserved only inside the `requested` branch, and added a regression test in `src/pull-request-state-sync.test.ts` covering a same-head `requested -> not_requested` transition.
- Current blocker: none.
- Next exact step: Commit and push the review-fix patch to PR #1372, then watch for CI and whether the automated thread clears or needs a follow-up response.
- Verification gap: none for the scoped issue verification; full repo test sweep not run.
- Files touched: `.codex-supervisor/issues/1365/issue-journal.md`, `src/pull-request-state-sync.test.ts`, `src/pull-request-state-sync.ts`.
- Rollback concern: low; the change is isolated to stale request observation cleanup and covered by targeted regression plus the existing policy/pre-merge suite.
- Last focused commands: `npx tsx --test src/pull-request-state-sync.test.ts`; `npx tsx --test src/pull-request-state-policy.test.ts src/review-handling.test.ts src/supervisor/supervisor-pre-merge-evaluation.test.ts`; `npm run build`
### Scratchpad
- Reproduced first with `npx tsx --test src/pull-request-state-sync.test.ts` failing on `Cannot find module './pull-request-state-sync'`.
- Review fix detail: preserve `copilot_review_requested_*` only when `pr.copilotReviewState ?? "not_requested"` is still `requested`; otherwise clear the stale same-head observation.
- Keep this section short. The supervisor may compact older notes automatically.
