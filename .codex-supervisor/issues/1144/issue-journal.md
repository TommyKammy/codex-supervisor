# Issue #1144: Promote fail-closed persisted artifact identity validation before post-merge follow-up promotion

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1144
- Branch: codex/issue-1144
- Workspace: .
- Journal: .codex-supervisor/issues/1144/issue-journal.md
- Current phase: addressing_review
- Attempt count: 5 (implementation=2, repair=3)
- Last head SHA: 095929d3caafb4ab35ab09eb6857a4dea9dc9332
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ853aevs|PRRT_kwDORgvdZ853aevx
- Repeated failure signature count: 1
- Updated at: 2026-03-28T01:09:36.539Z

## Latest Codex Summary
Extended [external-review-miss-artifact.test.ts](src/external-review/external-review-miss-artifact.test.ts) so `isPromotableExternalReviewMissArtifact` is exercised with the production-style historical context that omits `headSha`, while still proving malformed persisted provenance is rejected fail-closed. I also refreshed [issue-journal.md](.codex-supervisor/issues/1144/issue-journal.md) so the handoff no longer points at the stale implementation commit `6ad7898`.

Verification passed with `npx tsx --test src/external-review/external-review-miss-artifact.test.ts src/external-review/external-review-miss-history.test.ts src/supervisor/post-merge-audit-summary.test.ts` and `npm run build`. I have not resolved or replied to the GitHub review threads because that write action was not requested.

Summary: Added production-shape promotability coverage for historical external-review artifacts and removed the stale SHA reference from the issue journal handoff.
State hint: addressing_review
Blocked reason: none
Tests: `npx tsx --test src/external-review/external-review-miss-artifact.test.ts src/external-review/external-review-miss-history.test.ts src/supervisor/post-merge-audit-summary.test.ts`; `npm run build`
Next action: Push the branch update, then monitor PR #1147 for refreshed review state on the latest pushed branch head and resolve or respond to the remaining automated review threads if no further changes are requested.
Failure signature: PRRT_kwDORgvdZ853aevs|PRRT_kwDORgvdZ853aevx

## Active Failure Context
- Category: review
- Summary: 2 unresolved automated review thread(s) remain.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/1147#discussion_r3003856301
- Details:
  - .codex-supervisor/issues/1144/issue-journal.md:10 summary=_⚠️ Potential issue_ | _🟡 Minor_ **SHA reference inconsistency in journal.** Line 10 records the last head SHA as `6265d3b5667e1a9c79b7c552bc97091167ed87c0` (short: `6265d3b`),... url=https://github.com/TommyKammy/codex-supervisor/pull/1147#discussion_r3003856301
  - src/external-review/external-review-miss-artifact.test.ts:490 summary=_⚠️ Potential issue_ | _🟠 Major_ **Coverage gap: this test doesn’t mirror the production `headSha` call shape.** At Line 489 (and the repeated context objects), `headSha` is al... url=https://github.com/TommyKammy/codex-supervisor/pull/1147#discussion_r3003856305

## Codex Working Notes
### Current Handoff
- Hypothesis: Persisted artifact promotion was too permissive. Runtime external-review history accepted malformed optional evidence fields, and post-merge audit summarization trusted embedded local-review identity without checking it against the merged context.
- What changed: Added reusable identity/evidence validation helpers, enforced fail-closed validation before promoting persisted external-review miss artifacts, skipped post-merge audit artifacts whose embedded local-review issue/PR/branch/head identity mismatches the authoritative merged context, added focused regression tests, documented the guardrail in `docs/local-review.md`, merged `github/main` at `a5d6e16`, resolved the resulting conflicts in `src/supervisor/post-merge-audit-summary.ts` and `src/supervisor/post-merge-audit-summary.test.ts`, tightened `src/external-review/external-review-miss-artifact.ts` so durable-guardrail provenance `issueNumber` and `prNumber` must be positive integers before promotion, added production-call-shape coverage for promotability checks that omit `headSha`, and removed the stale `6ad7898` SHA reference from this journal handoff.
- Current blocker: none
- Next exact step: Push the branch update, then monitor PR #1147 for refreshed review state on the latest pushed branch head and resolve or respond to the remaining automated review threads if no further changes are requested.
- Verification gap: Full repo `npm test` still includes unrelated browser-smoke coverage and was not used for this issue; the focused external-review artifact/history tests, post-merge audit summary test, and `npm run build` passed after this review fix.
- Files touched: .codex-supervisor/issues/1144/issue-journal.md; docs/local-review.md; src/persisted-artifact-promotion.ts; src/external-review/external-review-miss-artifact.ts; src/external-review/external-review-miss-artifact.test.ts; src/external-review/external-review-miss-history.ts; src/external-review/external-review-miss-history.test.ts; src/local-review/repair-context.ts; src/local-review/runner.ts; src/supervisor/post-merge-audit-summary.ts; src/supervisor/post-merge-audit-summary.test.ts; src/supervisor/supervisor-status-rendering.ts
- Rollback concern: Tightened validation now skips malformed or mismatched persisted artifacts instead of promoting them; if older artifacts relied on permissive parsing, operator-facing summaries may surface fewer historical runtime hints until those artifacts are regenerated.
- Last focused commands: `npx tsx --test src/external-review/external-review-miss-artifact.test.ts src/external-review/external-review-miss-history.test.ts src/supervisor/post-merge-audit-summary.test.ts`; `npm run build`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
