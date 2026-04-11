# Issue #1417: Publish sticky tracked-PR status comments for persistent merge-stage blockers

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1417
- Branch: codex/issue-1417
- Workspace: .
- Journal: .codex-supervisor/issues/1417/issue-journal.md
- Current phase: addressing_review
- Attempt count: 5 (implementation=2, repair=3)
- Last head SHA: 410b3a456a4f814ebb797767260146b490f57f29
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-04-11T01:15:14.834Z

## Latest Codex Summary
Fetched the live PR review threads with the GitHub review-thread workflow, confirmed both unresolved CodeRabbit comments were valid on `e8ffcbf31a885804f885a250b2551b179079730f`, and fixed them in [src/post-turn-pull-request.ts#L275](src/post-turn-pull-request.ts#L275) and [src/post-turn-pull-request.ts#L316](src/post-turn-pull-request.ts#L316). Required-check mismatch signatures now use the full sorted check fingerprint while the sticky comment body stays compact, and lifecycle-mismatch / `mergeStateStatus === "BLOCKED"` comments now require a persisted merge-stage signal derived from the existing `provider_success_*` plus `merge_readiness_last_evaluated_at` fields so first-observation settle windows stay quiet.

I added focused regressions in [src/post-turn-pull-request.test.ts#L121](src/post-turn-pull-request.test.ts#L121), [src/post-turn-pull-request.test.ts#L1919](src/post-turn-pull-request.test.ts#L1919), [src/post-turn-pull-request.test.ts#L1998](src/post-turn-pull-request.test.ts#L1998), and [src/post-turn-pull-request.test.ts#L2065](src/post-turn-pull-request.test.ts#L2065), then verified with the focused file, the broader issue test set, and `npm run build`. I committed and pushed the fix as `410b3a4`; a fresh `fetch_comments.py` run shows both targeted CodeRabbit threads are now resolved on the new head. CodeRabbit also posted a top-level rate-limit notice on the PR conversation, and `gh pr view` currently reports `mergeStateStatus=UNSTABLE` while checks settle on the pushed head.

Summary: Fixed the live merge-stage sticky-comment review regressions, added regression coverage, pushed `410b3a4`, and confirmed the targeted review threads resolved on the new head.
State hint: addressing_review
Blocked reason: none
Tests: `npx tsx --test src/post-turn-pull-request.test.ts`; `npx tsx --test src/supervisor/supervisor-diagnostics-status-selection.test.ts src/doctor.test.ts src/post-turn-pull-request.test.ts src/recovery-reconciliation.test.ts`; `npm run build`
Next action: Watch PR #1421 on head `410b3a456a4f814ebb797767260146b490f57f29` for refreshed CI after the new push; review threads are resolved, so only follow up if new review feedback or failing checks appear.
Failure signature: none

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: CodeRabbit's two remaining review complaints were both valid on `e8ffcbf`, and the existing `provider_success_*` plus merge-readiness timestamps were sufficient to express the required persistence gate without adding new record schema.
- What changed: Reworked `buildRequiredCheckMismatchEvidence(...)` to return a full sorted check fingerprint, used the full fingerprint for `blockerSignature` while keeping the comment body compact, added `hasPersistentTrackedPrMergeStageSignal(...)` to require a persisted merge-stage signal before lifecycle-mismatch or `BLOCKED` merge-stage comments, added focused regression coverage for first-observation suppression plus full-signature republish/reorder behavior, committed the result as `410b3a4`, and pushed `codex/issue-1417`.
- Current blocker: none
- Next exact step: Watch PR #1421 on head `410b3a456a4f814ebb797767260146b490f57f29` for CI completion and only take further action if new review feedback or failing checks appear.
- Verification gap: None locally after the focused test file, the broader issue verification set, `npm run build`, and the post-push review-thread refresh; only fresh CI remains.
- Files touched: `src/post-turn-pull-request.ts`, `src/post-turn-pull-request.test.ts`, `.codex-supervisor/issues/1417/issue-journal.md`
- Rollback concern: The implementation reuses `last_host_local_pr_blocker_comment_*` dedupe fields for broader sticky-status comments, so reverting should restore the older draft/host-local-only publication behavior if comment churn appears.
- Last focused command: `python3 /home/tommy/.codex/plugins/cache/openai-curated/github/fb0a18376bcd9f2604047fbe7459ec5aed70c64b/skills/gh-address-comments/scripts/fetch_comments.py`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
- 2026-04-11: After pushing `410b3a4`, `fetch_comments.py` showed `PRRT_kwDORgvdZ856Q64P` outdated/resolved and `PRRT_kwDORgvdZ856Q64R` resolved on the new head; no unresolved review threads remain.
- 2026-04-11: `gh pr view 1421 --json headRefOid,mergeStateStatus,reviewDecision,url` reports head `410b3a456a4f814ebb797767260146b490f57f29` with `mergeStateStatus=UNSTABLE` while checks re-evaluate.
- 2026-04-11: `fetch_comments.py` on PR #1421 confirmed `PRRT_kwDORgvdZ856Q64P` and `PRRT_kwDORgvdZ856Q64R` are the only unresolved non-outdated review threads on head `e8ffcbf31a885804f885a250b2551b179079730f`.
- 2026-04-11: Local review fix adds a persisted merge-stage gate using `provider_success_*` plus `merge_readiness_last_evaluated_at !== provider_success_observed_at` so the first clean-check settle observation stays quiet.
- 2026-04-11: Verification after the live-thread fix: `npx tsx --test src/post-turn-pull-request.test.ts`; `npx tsx --test src/supervisor/supervisor-diagnostics-status-selection.test.ts src/doctor.test.ts src/post-turn-pull-request.test.ts src/recovery-reconciliation.test.ts`; `npm run build`
- 2026-04-11: Live review-thread fetch via `fetch_comments.py` confirmed unresolved thread `PRRT_kwDORgvdZ856Q04I` still targets `src/post-turn-pull-request.ts` and only asks to remove the unused `mergeability_mismatch` constant.
- 2026-04-11: Verification run after the edit: `npx tsx --test src/post-turn-pull-request.test.ts`; `npm run build`
- 2026-04-11: After pushing `e278784`, `fetch_comments.py` reported no unresolved non-outdated review threads on PR #1421; CI restarted on the new head and is pending.
- 2026-04-11: Focused review-fix verification on `e8ffcbf`: `npx tsx --test src/post-turn-pull-request.test.ts`; `npm run build`
- 2026-04-11: After pushing `e8ffcbf`, `fetch_comments.py` showed CodeRabbit thread `PRRT_kwDORgvdZ856Q3ej` outdated on the new head; thread `PRRT_kwDORgvdZ856Q3el` still appears unresolved/non-outdated even though the requested `syncJournal(record)` call is now present before `maybeCommentOnTrackedPrPersistentStatus(...)`.
