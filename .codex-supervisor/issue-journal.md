# Issue #1485: Bug: reviewThreads GraphQL surface can be truncated at 64KB and crash tracked PR reconciliation

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1485
- Branch: codex/issue-1485
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 2 (implementation=1, repair=1)
- Last head SHA: 8b509669717bb2359f4aad8f7d23341fb2d111f5
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ856mORL
- Repeated failure signature count: 1
- Updated at: 2026-04-13T17:11:14.627Z

## Latest Codex Summary
Protected the tracked-PR GitHub JSON fetch paths from local stdout truncation by routing machine-readable `gh` calls through `stdoutCaptureLimitBytes: null` in [github-review-surface.ts](src/github/github-review-surface.ts) and [github-pull-request-hydrator.ts](src/github/github-pull-request-hydrator.ts). That covers the reported `reviewThreads` failure and the sibling PR hydrator GraphQL surface that was exposed to the same 64KB truncation risk.

I added focused regressions in [github.test.ts](src/github/github.test.ts) and [github-pull-request-hydrator.test.ts](src/github/github-pull-request-hydrator.test.ts) that simulate a valid payload larger than the default capture limit and prove the pre-fix truncation behavior. The default bounded stdout behavior in `runCommand` is unchanged, and [command.test.ts](src/core/command.test.ts) still passes.

Committed and pushed on `codex/issue-1485` as `4d7f95a` and `8b50966`. Draft PR is open at https://github.com/TommyKammy/codex-supervisor/pull/1487. The worktree still has untracked supervisor runtime artifacts under `.codex-supervisor/`, which I left untouched.

Summary: Fixed large GraphQL JSON truncation for tracked PR reconciliation, added targeted regressions, pushed branch, and opened draft PR #1487.
State hint: draft_pr
Blocked reason: none
Tests: `node --test --import tsx src/github/github.test.ts`; `node --test --import tsx src/github/github-pull-request-hydrator.test.ts`; `node --test --import tsx src/core/command.test.ts`; `npm run build`
Next action: Wait for CI on draft PR #1487 and address any reported failures or review feedback.
Failure signature: PRRT_kwDORgvdZ856mORL

## Active Failure Context
- Category: review
- Summary: 1 unresolved automated review thread(s) remain.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/1487#discussion_r3074602547
- Details:
  - src/github/github-review-surface.ts:43 summary=_⚠️ Potential issue_ | _🟠 Major_ **Forwarded options are currently dropped before reaching the hydrator.** `runGhJsonCommand` is correct, but `GitHubPullRequestHydrator` is con... url=https://github.com/TommyKammy/codex-supervisor/pull/1487#discussion_r3074602547

## Codex Working Notes
### Current Handoff
- Hypothesis: the remaining review thread was valid; `GitHubReviewSurfaceClient` constructed `GitHubPullRequestHydrator` with an adapter that dropped `CommandOptions`, so the hydrator's `stdoutCaptureLimitBytes: null` override never reached `runGhCommand` on the status hydration path.
- What changed: forwarded `CommandOptions` through the review-surface hydrator adapter in `src/github/github-review-surface.ts` and added a `GitHubClient` regression in `src/github/github.test.ts` that proves `findOpenPullRequest(..., { purpose: "status" })` can hydrate a >64KB GraphQL review summary payload without truncation.
- Current blocker: none.
- Next exact step: commit and push the review fix to `codex/issue-1485`, then refresh PR #1487 for re-review.
- Verification gap: none for the local scope after `node --test --import tsx src/github/github.test.ts`, `node --test --import tsx src/github/github-pull-request-hydrator.test.ts`, and `npm run build` passed.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/github/github-review-surface.ts`, `src/github/github.test.ts`.
- Rollback concern: low; scope is limited to machine-readable GitHub JSON callers and preserves bounded capture for human-oriented command output.
- Last focused command: `npm run build`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
