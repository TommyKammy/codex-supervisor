# Issue #1417: Publish sticky tracked-PR status comments for persistent merge-stage blockers

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1417
- Branch: codex/issue-1417
- Workspace: .
- Journal: .codex-supervisor/issues/1417/issue-journal.md
- Current phase: addressing_review
- Attempt count: 5 (implementation=2, repair=3)
- Last head SHA: e8ffcbf31a885804f885a250b2551b179079730f
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ856Q64P|PRRT_kwDORgvdZ856Q64R
- Repeated failure signature count: 1
- Updated at: 2026-04-11T01:13:47.047Z

## Latest Codex Summary
Fetched the live PR review threads with the GitHub review-thread workflow and confirmed both unresolved CodeRabbit comments were still valid on `e8ffcbf31a885804f885a250b2551b179079730f`. In [src/post-turn-pull-request.ts#L275](src/post-turn-pull-request.ts#L275) I changed the required-check mismatch evidence builder to sort the full check set deterministically, kept the sticky comment body compact with a local slice, and now build the dedupe signature from the full sorted fingerprint so reorder-only check churn does not republish while changes outside the displayed prefix still do. In [src/post-turn-pull-request.ts#L316](src/post-turn-pull-request.ts#L316) I added a merge-stage persistence gate based on the existing `provider_success_*` and `merge_readiness_last_evaluated_at` fields so lifecycle-mismatch and `mergeStateStatus === "BLOCKED"` comments do not publish on the first clean-check settle observation.

I added focused regressions in [src/post-turn-pull-request.test.ts#L121](src/post-turn-pull-request.test.ts#L121), [src/post-turn-pull-request.test.ts#L1919](src/post-turn-pull-request.test.ts#L1919), [src/post-turn-pull-request.test.ts#L1998](src/post-turn-pull-request.test.ts#L1998), and [src/post-turn-pull-request.test.ts#L2065](src/post-turn-pull-request.test.ts#L2065) to cover the persisted merge-stage signal, first-observation suppression, full-signature republish on hidden-check changes, and reorder stability. Verification passed locally with the focused file, the broader issue test set, and `npm run build`. I have not replied to or resolved review threads on GitHub because you did not ask for GitHub write actions.

Summary: Fixed the two live merge-stage sticky-comment review regressions locally, added regression coverage, and refreshed the issue journal.
State hint: addressing_review
Blocked reason: none
Tests: `npx tsx --test src/post-turn-pull-request.test.ts`; `npx tsx --test src/supervisor/supervisor-diagnostics-status-selection.test.ts src/doctor.test.ts src/post-turn-pull-request.test.ts src/recovery-reconciliation.test.ts`; `npm run build`
Next action: Commit and push the local review-thread fixes on `codex/issue-1417`, then watch PR #1421 for refreshed CodeRabbit/CI results.
Failure signature: PRRT_kwDORgvdZ856Q64P|PRRT_kwDORgvdZ856Q64R

## Active Failure Context
- Category: review
- Summary: 2 unresolved automated review thread(s) remain on the remote PR head; both are fixed locally and pending commit/push.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/1421#discussion_r3067289084
- Details:
  - src/post-turn-pull-request.ts:283 summary=_⚠️ Potential issue_ | _🟠 Major_ **Use a full, deterministic check fingerprint for the dedupe signature.** `buildRequiredCheckMismatchEvidence()` truncates to four entries, and... url=https://github.com/TommyKammy/codex-supervisor/pull/1421#discussion_r3067289084
  - src/post-turn-pull-request.ts:362 summary=_⚠️ Potential issue_ | _🟠 Major_ **Gate merge-stage sticky comments on a persistence signal.** This helper posts a “persistent” near-merge blocker comment on the first clean-ch... url=https://github.com/TommyKammy/codex-supervisor/pull/1421#discussion_r3067289087

## Codex Working Notes
### Current Handoff
- Hypothesis: CodeRabbit's two remaining review complaints were both valid on `e8ffcbf`: required-check mismatch dedupe still used a truncated unsorted fingerprint, and merge-stage lifecycle/blocker comments still published on the first clean-check observation instead of waiting for a persisted merge-stage signal.
- What changed: Reworked `buildRequiredCheckMismatchEvidence(...)` to return a full sorted check fingerprint, used the full fingerprint for `blockerSignature` while keeping the comment body compact, added `hasPersistentTrackedPrMergeStageSignal(...)` to require a persisted merge-stage signal before lifecycle-mismatch or `BLOCKED` merge-stage comments, and added focused regression coverage for first-observation suppression plus full-signature republish/reorder behavior.
- Current blocker: none
- Next exact step: Commit the local fixes, push `codex/issue-1417`, and refresh PR #1421 review-thread state to confirm `PRRT_kwDORgvdZ856Q64P` and `PRRT_kwDORgvdZ856Q64R` go outdated or resolve on the new head.
- Verification gap: None locally after the focused test file, the broader issue verification set, and `npm run build`; only refreshed remote review/CI remains.
- Files touched: `src/post-turn-pull-request.ts`, `src/post-turn-pull-request.test.ts`, `.codex-supervisor/issues/1417/issue-journal.md`
- Rollback concern: The implementation reuses `last_host_local_pr_blocker_comment_*` dedupe fields for broader sticky-status comments, so reverting should restore the older draft/host-local-only publication behavior if comment churn appears.
- Last focused command: `npx tsx --test src/supervisor/supervisor-diagnostics-status-selection.test.ts src/doctor.test.ts src/post-turn-pull-request.test.ts src/recovery-reconciliation.test.ts`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
- 2026-04-11: `fetch_comments.py` on PR #1421 confirmed `PRRT_kwDORgvdZ856Q64P` and `PRRT_kwDORgvdZ856Q64R` are the only unresolved non-outdated review threads on head `e8ffcbf31a885804f885a250b2551b179079730f`.
- 2026-04-11: Local review fix adds a persisted merge-stage gate using `provider_success_*` plus `merge_readiness_last_evaluated_at !== provider_success_observed_at` so the first clean-check settle observation stays quiet.
- 2026-04-11: Verification after the live-thread fix: `npx tsx --test src/post-turn-pull-request.test.ts`; `npx tsx --test src/supervisor/supervisor-diagnostics-status-selection.test.ts src/doctor.test.ts src/post-turn-pull-request.test.ts src/recovery-reconciliation.test.ts`; `npm run build`
- 2026-04-11: Live review-thread fetch via `fetch_comments.py` confirmed unresolved thread `PRRT_kwDORgvdZ856Q04I` still targets `src/post-turn-pull-request.ts` and only asks to remove the unused `mergeability_mismatch` constant.
- 2026-04-11: Verification run after the edit: `npx tsx --test src/post-turn-pull-request.test.ts`; `npm run build`
- 2026-04-11: After pushing `e278784`, `fetch_comments.py` reported no unresolved non-outdated review threads on PR #1421; CI restarted on the new head and is pending.
- 2026-04-11: Focused review-fix verification on `e8ffcbf`: `npx tsx --test src/post-turn-pull-request.test.ts`; `npm run build`
- 2026-04-11: After pushing `e8ffcbf`, `fetch_comments.py` showed CodeRabbit thread `PRRT_kwDORgvdZ856Q3ej` outdated on the new head; thread `PRRT_kwDORgvdZ856Q3el` still appears unresolved/non-outdated even though the requested `syncJournal(record)` call is now present before `maybeCommentOnTrackedPrPersistentStatus(...)`.
