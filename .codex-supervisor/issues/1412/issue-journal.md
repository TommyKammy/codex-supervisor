# Issue #1412: Post deduplicated PR comments when tracked ready-promotion is blocked locally

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1412
- Branch: codex/issue-1412
- Workspace: .
- Journal: .codex-supervisor/issues/1412/issue-journal.md
- Current phase: addressing_review
- Attempt count: 3 (implementation=2, repair=1)
- Last head SHA: 2412c751b1d0dac7eeb4ebd220b1a9fac067ae55
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ856AmTu|PRRT_kwDORgvdZ856AmT3
- Repeated failure signature count: 1
- Updated at: 2026-04-10T01:13:39.132Z

## Latest Codex Summary
Published the checkpoint on `codex/issue-1412` and opened draft PR [#1413](https://github.com/TommyKammy/codex-supervisor/pull/1413). The implementation commit `4212532` adds the tracked ready-promotion blocker comment path in [src/post-turn-pull-request.ts](src/post-turn-pull-request.ts) with the focused regression in [src/post-turn-pull-request.test.ts](src/post-turn-pull-request.test.ts), and I pushed two small follow-up journal commits so the handoff state is recorded in [.codex-supervisor/issues/1412/issue-journal.md](.codex-supervisor/issues/1412/issue-journal.md).

Verification passed on the published branch with `npx tsx --test src/post-turn-pull-request.test.ts src/recovery-reconciliation.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts` and `npm run build`. The remaining gap is the manual smoke test against a real tracked draft PR blocked by `npm run verify:paths`. The only local dirt left is untracked supervisor runtime scratch under `.codex-supervisor/`, which I left untouched.

Summary: Pushed the ready-promotion blocker comment fix, opened draft PR #1413, and updated the issue journal with the published handoff state
State hint: draft_pr
Blocked reason: none
Tests: `npx tsx --test src/post-turn-pull-request.test.ts src/recovery-reconciliation.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts`; `npm run build`
Next action: Run the manual smoke test for the `npm run verify:paths` blocked-draft scenario on PR #1413, or hand the draft PR off for review if that validation is deferred
Failure signature: PRRT_kwDORgvdZ856AmTu|PRRT_kwDORgvdZ856AmT3

## Active Failure Context
- Category: review
- Summary: 2 unresolved automated review thread(s) remain.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/1413#discussion_r3061500943
- Details:
  - src/post-turn-pull-request.test.ts:1409 summary=_⚠️ Potential issue_ | _🟡 Minor_ **Reuse the first run’s persisted dedupe state here.** This rerun hand-seeds `last_host_local_pr_blocker_comment_*`, so it would still pass eve... url=https://github.com/TommyKammy/codex-supervisor/pull/1413#discussion_r3061500943
  - src/post-turn-pull-request.ts:595 summary=_⚠️ Potential issue_ | _🟠 Major_ **Also post the blocker comment on the fail-closed head-mismatch path.** This new hook only covers the `!pathHygieneGate.ok` branch. url=https://github.com/TommyKammy/codex-supervisor/pull/1413#discussion_r3061500954

## Codex Working Notes
### Current Handoff
- Hypothesis: The remaining review gaps were real: the fail-closed local/remote head mismatch branch still skipped the tracked PR blocker comment helper, and the dedupe regression test was not proving persisted state because it hand-seeded the comment signature fields.
- What changed: Reused `maybeCommentOnTrackedPrHostLocalBlocker(...)` on the workstation-local path hygiene head-mismatch return path and tightened the dedupe regression to rerun from `firstResult.record` instead of synthetic dedupe fields.
- Current blocker: none.
- Next exact step: Commit the review fixes on `codex/issue-1412`, push the branch, and leave PR #1413 ready for another review pass.
- Verification gap: Manual PR smoke test against a real tracked draft PR blocked by `npm run verify:paths` is still not exercised in this workspace.
- Files touched: `src/post-turn-pull-request.ts`, `src/post-turn-pull-request.test.ts`, `.codex-supervisor/issues/1412/issue-journal.md`.
- Rollback concern: Low; the change is scoped to tracked draft ready-promotion blocker comments and reuses existing dedupe state fields.
- Last focused commands: `npx tsx --test src/post-turn-pull-request.test.ts src/recovery-reconciliation.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts`; `npm run build`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
