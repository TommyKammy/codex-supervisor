# Issue #1442: Comment on GitHub issues when execution-ready metadata is missing

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1442
- Branch: codex/issue-1442
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 2 (implementation=1, repair=1)
- Last head SHA: c4a690b5b9df9f0b928af9706176cc6bd9772573
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ856sDWV|PRRT_kwDORgvdZ856sDWX|PRRT_kwDORgvdZ856sDWb|PRRT_kwDORgvdZ856sDWe
- Repeated failure signature count: 1
- Updated at: 2026-04-14T01:40:55.000Z

## Latest Codex Summary
Addressed the active review threads on top of `c4a690b` by tightening sticky-comment ownership matching, narrowing sequenced-child repair guidance to the canonical predecessor-dependency shape, making blocker-comment sync best-effort on restart paths, and paginating issue comment reads so older sticky comments remain discoverable.

I intentionally did not broad-brush paginate every PR comment surface mentioned by CodeRabbit. The concrete regression here was issue-comment lookup for machine-managed sticky comments; widening the patch to unrelated review-thread and PR top-level comment surfaces would have exceeded the issue scope without evidence of a behavior break in those paths. Focused tests covering the new guidance, null-`databaseId` dedupe, best-effort warning path, issue-comment pagination, recovery clearing, and `npm run build` are green.

Summary: Addressed review feedback for sticky comment dedupe, sequenced-child guidance, best-effort sync, and issue-comment pagination.
State hint: addressing_review
Blocked reason: none
Tests: `npx tsx --test src/run-once-issue-selection.test.ts src/github/github.test.ts src/supervisor/supervisor-recovery-reconciliation.test.ts`; `npm run build`
Next action: Commit the review-fix checkpoint, then push/update PR #1495 for re-review.
Failure signature: none

## Active Failure Context
- Category: review
- Summary: 4 unresolved automated review thread(s) remain.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/1495#discussion_r3076667581
- Details:
  - src/github/github-review-surface.ts:588 summary=_⚠️ Potential issue_ | _🟠 Major_ 🧩 Analysis chain 🏁 Script executed: Repository: TommyKammy/codex-supervisor Length of output: 529 --- 🏁 Script executed: Repository: TommyKa... url=https://github.com/TommyKammy/codex-supervisor/pull/1495#discussion_r3076667581
  - src/requirements-blocker-issue-comment.ts:33 summary=_⚠️ Potential issue_ | _🟠 Major_ **Don't require `databaseId` just to recognize the sticky comment.** `IssueComment.databaseId` is nullable in `src/core/types.ts`, and `fetchIs... url=https://github.com/TommyKammy/codex-supervisor/pull/1495#discussion_r3076667585
  - src/requirements-blocker-issue-comment.ts:61 summary=_⚠️ Potential issue_ | _🟠 Major_ **Fix the sequenced-child `Depends on:` guidance.** This template currently tells sequenced children to keep `Depends on: none`, which is the w... url=https://github.com/TommyKammy/codex-supervisor/pull/1495#discussion_r3076667590
  - src/run-once-issue-selection.ts:568 summary=_⚠️ Potential issue_ | _🟠 Major_ **Treat requirements-blocker comment sync as best-effort to avoid restart-path failures.** If this external call fails, the function throws aft... url=https://github.com/TommyKammy/codex-supervisor/pull/1495#discussion_r3076667593

## Codex Working Notes
### Current Handoff
- Hypothesis: The remaining automated review findings were a mix of one real dedupe bug (`databaseId` nullable), one real resilience gap (comment sync on restart path), one guidance wording gap for sequenced children, and one overly broad pagination suggestion whose concrete regression surface was older issue comments rather than every PR comment feed.
- What changed: Removed the `databaseId` requirement from sticky-comment recognition in `src/requirements-blocker-issue-comment.ts`; updated sequenced-child repair text to prefer `Depends on: #<previous-issue-number>` when earlier sequence work truly blocks execution while still allowing `Depends on: none`; wrapped requirements-blocker comment sync in a best-effort warning helper in `src/run-once-issue-selection.ts`; paginated `fetchIssueComments` in `src/github/github-review-surface.ts`; added focused tests in `src/run-once-issue-selection.test.ts` and `src/github/github.test.ts`.
- Current blocker: none
- Next exact step: Commit the current diff and update PR #1495 so GitHub can re-evaluate the addressed review threads.
- Verification gap: No broader full-suite rerun beyond the focused areas touched in this repair pass.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/requirements-blocker-issue-comment.ts`, `src/run-once-issue-selection.ts`, `src/github/github-review-surface.ts`, `src/run-once-issue-selection.test.ts`, `src/github/github.test.ts`.
- Rollback concern: Low; the runtime changes are narrowly scoped to issue-comment lookup, blocker-comment ownership/guidance, and restart-path error handling.
- Last focused command: `npx tsx --test src/run-once-issue-selection.test.ts src/github/github.test.ts src/supervisor/supervisor-recovery-reconciliation.test.ts`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
