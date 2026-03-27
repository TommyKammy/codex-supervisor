# Issue #1137: Promote missed focused test regressions from post-merge audit history into actionable follow-up candidates

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1137
- Branch: codex/issue-1137
- Workspace: .
- Journal: .codex-supervisor/issues/1137/issue-journal.md
- Current phase: addressing_review
- Attempt count: 2 (implementation=1, repair=1)
- Last head SHA: e379f37af1ec438b26da7806dda355076da451c9
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ853Zrug|PRRT_kwDORgvdZ853Zrur
- Repeated failure signature count: 1
- Updated at: 2026-03-27T22:51:05.195Z

## Latest Codex Summary
Implemented the post-merge audit follow-up path in [post-merge-audit-summary.ts](src/supervisor/post-merge-audit-summary.ts). The summary schema is now v4 and includes advisory-only `followUpCandidates` for missed focused test regressions sourced from persisted external-review miss artifacts, with merged issue/PR and source evidence traceability. I added the focused reproducer in [post-merge-audit-summary.test.ts](src/supervisor/post-merge-audit-summary.test.ts), and updated the runtime/API contract tests in [post-merge-audit-summary-runtime.test.ts](src/supervisor/post-merge-audit-summary-runtime.test.ts) and [supervisor-http-server.test.ts](src/backend/supervisor-http-server.test.ts).

Commits are `677e985` and `e379f37`. Draft PR: https://github.com/TommyKammy/codex-supervisor/pull/1141

Tests run:
- `npx tsx --test src/supervisor/post-merge-audit-summary.test.ts`
- `npx tsx --test src/supervisor/post-merge-audit-summary-runtime.test.ts`
- `npx tsx --test src/supervisor/post-merge-audit-artifact.test.ts`
- `npx tsx --test src/backend/supervisor-http-server.test.ts`

There are still untracked supervisor scratch files under `.codex-supervisor/` outside the committed scope.

Summary: Added advisory post-merge `followUpCandidates` for missed focused test regressions, covered with focused tests, pushed branch updates, and opened draft PR #1141
State hint: draft_pr
Blocked reason: none
Tests: npx tsx --test src/supervisor/post-merge-audit-summary.test.ts; npx tsx --test src/supervisor/post-merge-audit-summary-runtime.test.ts; npx tsx --test src/supervisor/post-merge-audit-artifact.test.ts; npx tsx --test src/backend/supervisor-http-server.test.ts
Next action: Monitor draft PR #1141 and address any CI or review follow-up
Failure signature: PRRT_kwDORgvdZ853Zrug|PRRT_kwDORgvdZ853Zrur

## Active Failure Context
- Category: review
- Summary: 2 unresolved automated review thread(s) remain.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/1141#discussion_r3003575642
- Details:
  - src/supervisor/post-merge-audit-summary.ts:601 summary=_⚠️ Potential issue_ | _🟠 Major_ **Validate the optional evidence fields here too.** `sourceUrl` and `sourceThreadId` are copied into the DTO on Lines 934-936, but this guard d... url=https://github.com/TommyKammy/codex-supervisor/pull/1141#discussion_r3003575642
  - src/supervisor/post-merge-audit-summary.ts:942 summary=_⚠️ Potential issue_ | _🟠 Major_ **Cross-check the miss artifact before promoting it.** This trusts `externalReviewMissesPath` entirely. url=https://github.com/TommyKammy/codex-supervisor/pull/1141#discussion_r3003575654

## Codex Working Notes
### Current Handoff
- Hypothesis: The remaining review risk was isolated to persisted external-review miss ingestion in `summarizePostMergeAuditPatterns`: malformed nullable evidence fields could slip through the type guard, and a stale `external_review_misses_path` could attach follow-up candidates to the wrong merged issue.
- What changed: Tightened `isExternalReviewRegressionCandidate` to validate nullable `sourceUrl` and `sourceThreadId`, added a metadata cross-check before promoting miss-artifact candidates, and added focused summary tests for malformed evidence and mismatched miss-artifact metadata.
- Current blocker: none.
- Next exact step: Commit the review fix, push `codex/issue-1137`, and clear the two unresolved automated review threads on PR #1141.
- Verification gap: None in the approved focused targets; broader unrelated suites remain unrun.
- Files touched: `.codex-supervisor/issues/1137/issue-journal.md`, `src/supervisor/post-merge-audit-summary.ts`, `src/supervisor/post-merge-audit-summary.test.ts`.
- Rollback concern: Low; the behavior is additive and advisory-only, but consumers expecting schema v3 would need the corresponding v4 field.
- Last focused command: `npx tsx --test src/supervisor/post-merge-audit-artifact.test.ts`
### Scratchpad
- Reproducer before fix: `summary.followUpCandidates === undefined` for a post-merge artifact with a persisted regression-test miss candidate.
- Review fix failure context: `PRRT_kwDORgvdZ853Zrug|PRRT_kwDORgvdZ853Zrur` flagged missing nullable evidence validation and missing miss-artifact metadata verification in the summary promotion path.
- Focused verification: `npx tsx --test src/supervisor/post-merge-audit-summary.test.ts`, `npx tsx --test src/supervisor/post-merge-audit-summary-runtime.test.ts`, `npx tsx --test src/supervisor/post-merge-audit-artifact.test.ts`.
