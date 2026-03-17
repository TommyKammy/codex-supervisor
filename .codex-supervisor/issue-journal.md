# Issue #457: CodeRabbit settled wait: add regression coverage for CI-green immediate-merge races

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/457
- Branch: codex/issue-457
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: waiting_ci
- Attempt count: 3 (implementation=1, repair=2)
- Last head SHA: 119e18e316763d97d9c8e22ab62b8c55e22114a7
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-17T07:33:05.815Z

## Latest Codex Summary
Addressed the remaining CodeRabbit review finding on PR #460 by sanitizing the committed journal metadata, committed the repair as `119e18e`, pushed `codex/issue-457`, and resolved the CodeRabbit thread via GitHub.

No code or test fixtures changed in this turn. The PR is no longer draft, the review thread is resolved, and CI restarted on the updated branch; at the time of this note, `build (macos-latest)` had already passed while `build (ubuntu-latest)` and `CodeRabbit` were still pending.

Summary: Pushed the journal-only review fix for PR #460, resolved the CodeRabbit thread, and handed the branch off to CI.
State hint: waiting_ci
Blocked reason: none
Tests: not run; journal-only review fix
Failure signature: none
Next action: Monitor the refreshed PR #460 checks and only intervene if CI or follow-up review reports a new issue.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: CodeRabbit can emit later review-thread comments with missing `originalCommitOid`; those comments are still safe to treat as current-head activity only when a stronger CodeRabbit current-head observation already exists.
- What changed: Added focused review-signal and hydrator tests for weakly anchored CodeRabbit review comments, including a stale-head negative case; updated `inferConfiguredBotCurrentHeadObservedAt` to extend `currentHeadObservedAt` only for later CodeRabbit comments lacking `originalCommitOid` after a prior strong current-head observation. This turn also sanitized the issue journal metadata to remove absolute local paths called out in review.
- Current blocker: none
- Next exact step: Wait for the refreshed PR #460 checks to finish and react only if CI or review opens a new failure.
- Verification gap: none for the focused review-signal, pull-request-state, supervisor lifecycle, hydrator, and build checks requested by the issue; no additional verification is needed for this journal-only repair.
- Files touched: src/github/github-review-signals.ts; src/github/github-review-signals.test.ts; src/github/github-pull-request-hydrator.test.ts; .codex-supervisor/issue-journal.md
- Rollback concern: The weak-anchor extension is intentionally limited to CodeRabbit-authored review-thread comments that happen after a strong current-head observation; broadening that rule to other bots or comments without the prior observation would risk promoting stale history.
- Last focused command: gh pr view 460 --json isDraft,mergeStateStatus,reviewDecision,statusCheckRollup,headRefName
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
- Reproducing signature before the fix: `currentHeadObservedAt` stayed at the earlier summary-only current-head review and did not advance to a later CodeRabbit review-thread comment with `originalCommitOid: null`.
- Verification commands: `npx tsx --test src/github/github-review-signals.test.ts`; `npx tsx --test src/pull-request-state.test.ts`; `npx tsx --test src/supervisor/supervisor-lifecycle.test.ts`; `npm ci`; `npx tsx --test src/github/github-pull-request-hydrator.test.ts`; `npm run build`; `rg -n '^- (Workspace|Journal):' .codex-supervisor/issue-journal.md`; `git commit -m "Sanitize issue journal paths"`; `git push origin codex/issue-457`; `gh api graphql -f query='mutation($threadId: ID!) { resolveReviewThread(input: {threadId: $threadId}) { thread { id isResolved } } }' -F threadId=PRRT_kwDORgvdZ850x8eI`; `gh pr view 460 --json isDraft,mergeStateStatus,reviewDecision,statusCheckRollup,headRefName`.
