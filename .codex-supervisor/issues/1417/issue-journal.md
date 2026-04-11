# Issue #1417: Publish sticky tracked-PR status comments for persistent merge-stage blockers

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1417
- Branch: codex/issue-1417
- Workspace: .
- Journal: .codex-supervisor/issues/1417/issue-journal.md
- Current phase: repairing_ci
- Attempt count: 6 (implementation=2, repair=4)
- Last head SHA: 0353ba62a7f7118bac8c3a6fe9801c92f44ea154
- Blocked reason: none
- Last failure signature: build (ubuntu-latest):fail
- Repeated failure signature count: 3
- Updated at: 2026-04-11T01:19:42.266Z

## Latest Codex Summary
Repaired the failing Ubuntu CI gate for PR #1421 by removing the committed workstation-local skill-cache path from [.codex-supervisor/issues/1417/issue-journal.md](.codex-supervisor/issues/1417/issue-journal.md). The feature code from the prior turn remains unchanged; this turn only publishes the already-redacted journal content that `npm run verify:paths` requires on Linux.

`gh run view 24271286569 --log-failed` showed the exact failure in `npm run verify:paths`, pointing at the tracked journal entry that still mentioned an absolute home-directory skill path on head `0353ba62a7f7118bac8c3a6fe9801c92f44ea154`. Local verification now passes with `npm run verify:paths` and `npm run build`, so the remaining step is pushing the journal-only repair and waiting for refreshed CI on the PR.

Summary: Repaired the tracked journal path that broke Ubuntu `verify:paths`; the feature code is unchanged and local verification now passes.
State hint: repairing_ci
Blocked reason: none
Tests: `npm run verify:paths`; `npm run build`
Next action: Push the journal-only repair to `codex/issue-1417`, then watch PR #1421 for refreshed CI and only re-enter if a new failure appears.
Failure signature: build (ubuntu-latest):fail

## Active Failure Context
- Category: checks
- Summary: PR #1421 has failing checks.
- Command or source: gh pr checks
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/1421
- Details:
  - build (ubuntu-latest) (fail/FAILURE) https://github.com/TommyKammy/codex-supervisor/actions/runs/24271286569/job/70876664664

## Codex Working Notes
### Current Handoff
- Hypothesis: The failing Ubuntu CI job is not a code regression; `npm run verify:paths` is rejecting a committed absolute workstation path that remained in the tracked issue journal on head `0353ba62a7f7118bac8c3a6fe9801c92f44ea154`.
- What changed: The worktree journal already redacted the recorded skill-script path to `python3 <redacted-local-path>`, which removes the forbidden absolute skill-cache reference that broke `verify:paths`; this turn is validating and publishing that journal-only repair.
- Current blocker: none
- Next exact step: Push the journal-only path redaction on `codex/issue-1417`, then watch PR #1421 for the refreshed CI result and only re-enter if a new failure appears.
- Verification gap: Fresh remote CI is still needed after the journal-only repair is pushed.
- Files touched: `.codex-supervisor/issues/1417/issue-journal.md`
- Rollback concern: The implementation reuses `last_host_local_pr_blocker_comment_*` dedupe fields for broader sticky-status comments, so reverting should restore the older draft/host-local-only publication behavior if comment churn appears.
- Last focused command: `gh run view 24271286569 --log-failed`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
- 2026-04-11: `gh run view 24271286569 --log-failed` shows Ubuntu CI failed in `npm run verify:paths` because `.codex-supervisor/issues/1417/issue-journal.md` still contained an absolute skill-cache script path on the committed PR head.
- 2026-04-11: Local `npm run verify:paths` passes once the journal uses `python3 <redacted-local-path>` instead of the absolute workstation path.
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
