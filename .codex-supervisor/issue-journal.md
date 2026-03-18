# Issue #511: External-review misses: emit a follow-up action digest from miss analysis

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/511
- Branch: codex/issue-511
- Workspace: /home/tommy/Dev/codex-supervisor-self-worktrees/issue-511
- Journal: /home/tommy/Dev/codex-supervisor-self-worktrees/issue-511/.codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 3 (implementation=2, repair=1)
- Last head SHA: b54a208be350910d87ff0d519da03bf0a7ebabfd
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ851BC62|PRRT_kwDORgvdZ851BC67
- Repeated failure signature count: 1
- Updated at: 2026-03-17T23:59:24.669Z

## Latest Codex Summary
Draft PR #518 is open for `codex/issue-511`: https://github.com/TommyKammy/codex-supervisor/pull/518. I fixed the two CodeRabbit review findings, reran the focused external-review miss tests plus `npm run build`, pushed `c7b7a45` to `origin/codex/issue-511`, and resolved both review threads on GitHub.

The digest now fails fast if a missed finding reaches it without a prevention target, and the journal timeline bullets now scan cleanly without repeating the same opening phrasing. Local uncommitted paths are the journal update and the pre-existing `.codex-supervisor/replay/` scratch dir.

Summary: Pushed review-fix commit `c7b7a45` to PR #518, reran focused verification, and resolved both CodeRabbit threads
State hint: addressing_review
Blocked reason: none
Tests: `npx tsx --test src/external-review/external-review-miss-artifact.test.ts src/external-review/external-review-miss-persistence.test.ts`; `npm run build`
Failure signature: none
Next action: Monitor PR #518 for any new CI or review feedback after commit `c7b7a45`

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the follow-up digest should keep treating missing prevention targets as an invariant break, because silently dropping malformed missed findings would hide operator work that the digest is supposed to surface.
- What changed: tightened `external-review-miss-digest.ts` so every `missed_by_local_review` finding is inspected, the digest now throws if any missed finding arrives without a prevention target, added a focused regression test for that malformed-artifact path, and reworded the two scratchpad bullets that CodeRabbit flagged as repetitive.
- Current blocker: none
- Next exact step: monitor PR #518 for any new review or CI movement after commit `c7b7a45`.
- Verification gap: none locally after rerunning focused external-review artifact/persistence tests and `npm run build`.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/external-review/external-review-miss-artifact.test.ts`, `src/external-review/external-review-miss-digest.ts`
- Rollback concern: removing the digest writer would leave the JSON artifact as the only miss-analysis output, forcing operators back to raw artifact inspection and dropping the deterministic next-action summary promised by this issue.
- Last focused command: `npx tsx --test src/external-review/external-review-miss-artifact.test.ts src/external-review/external-review-miss-persistence.test.ts`
### Scratchpad (workspace-local date in Asia/Tokyo unless noted)
- 2026-03-18 (JST): Focused reproducer first failed in `src/external-review/external-review-miss-artifact.test.ts` because missed findings in the artifact had `preventionTarget: undefined`; failure signature: `missing-prevention-target`.
- 2026-03-18 (JST): Deterministic target precedence is `issue_comment -> issue_template`, `top_level_review -> review_prompt`, severe anchored `review_thread` misses -> `durable_guardrail`, regression-qualified `review_thread` misses -> `regression_test`, otherwise `review_prompt`.
- 2026-03-18 (JST): `npm run build` initially failed with `sh: 1: tsc: not found`; `npm ci` restored the local toolchain and the rerun passed.
- 2026-03-18 (JST): Added a focused reproducer in `src/external-review/external-review-miss-persistence.test.ts`; it first failed with `ENOENT` for `external-review-misses-head-deadbeefcafe.md`, yielding failure signature `missing-follow-up-digest`.
- 2026-03-18 (JST): `external-review-miss-digest.ts` now persists an adjacent markdown digest with `current-head` vs `stale-head` metadata, prevention-target grouping, and one deterministic recommended next action per missed finding.
- 2026-03-18 (JST): Review repair: `buildExternalReviewMissFollowUpDigest` now throws if any `missed_by_local_review` finding reaches the digest without a prevention target, and the new artifact test locks that invariant in place.
- 2026-03-18 (JST): Pushed `codex/issue-511`, retried `gh pr create` after the initial race with branch publication, and opened draft PR #518. Current GitHub check state is `UNSTABLE` only because CI jobs are still queued.
- 2026-03-18 (JST): Pushed review-fix commit `c7b7a45` and resolved CodeRabbit threads `PRRT_kwDORgvdZ851BC62` and `PRRT_kwDORgvdZ851BC67` after focused verification passed.
