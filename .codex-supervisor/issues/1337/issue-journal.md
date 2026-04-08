# Issue #1337: Enhancement: auto-repair current-head fix_blocked local-review findings on tracked PRs

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1337
- Branch: codex/issue-1337
- Workspace: .
- Journal: .codex-supervisor/issues/1337/issue-journal.md
- Current phase: addressing_review
- Attempt count: 5 (implementation=3, repair=1)
- Last head SHA: 88cc322af3a58c89d1a6b13dfbf5496ec7115138
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ855fYSl
- Repeated failure signature count: 1
- Updated at: 2026-04-08T07:50:39.616Z

## Latest Codex Summary
- None yet.

## Active Failure Context
- Category: review
- Summary: 1 unresolved automated review thread(s) remain.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/1349#discussion_r3049860205
- Details:
  - src/pull-request-state.ts:896 summary=_⚠️ Potential issue_ | _🟠 Major_ **Honor `REVIEW_REQUIRED` before entering the new fix-blocked repair lane.** Line 888 only checks CI/thread/conflict cleanliness, so a current-... url=https://github.com/TommyKammy/codex-supervisor/pull/1349#discussion_r3049860205

## Codex Working Notes
### Current Handoff
- Hypothesis: The remaining CodeRabbit thread was still open because the `REVIEW_REQUIRED` safeguard lived inside `localReviewFixBlockedNeedsRepair`, while the flagged `pull-request-state.ts` branch still looked ungated in isolation. Making the state branch mirror the helper predicate directly should satisfy the thread without changing behavior.
- What changed: Added an explicit `reviewDecisionAllowsSamePrRepair(pr)` guard to the `localReviewFixBlockedNeedsRepair` branch in `inferStateFromPullRequest`, keeping the same review-gate precedence visible at the state-transition site that CodeRabbit flagged. Existing regressions for `REVIEW_REQUIRED` `fix_blocked` handling and the pre-merge DTO remain in place and passed again.
- Current blocker: awaiting refreshed review/CI signal on PR #1349 after pushing commit `00434db`.
- Next exact step: Re-check PR #1349 review threads and CI on head `00434db`, then address any newly surfaced valid feedback if the remaining automated thread does not resolve on refresh.
- Verification gap: Full `npm test` wrapper was not used because this repair touched a single backend state branch and prior full-wrapper runs hit unrelated browser-helper failures; focused `tsx --test` coverage for the review/state/pre-merge paths plus `tsc --noEmit` are green.
- Files touched: src/pull-request-state.ts; .codex-supervisor/issues/1337/issue-journal.md
- Rollback concern: Low; this is a redundant guard that preserves existing helper behavior while making the review gate explicit at the flagged branch.
- Last focused command: gh auth status; gh pr view 1349 --json number,url,isDraft,reviewDecision,mergeStateStatus,headRefOid,headRefName,statusCheckRollup; gh api graphql -f query='query($owner:String!, $name:String!, $number:Int!) { repository(owner:$owner, name:$name) { pullRequest(number:$number) { reviewThreads(first:50) { nodes { id isResolved isOutdated path line comments(last:1) { nodes { id url body author { login } createdAt } } } } } } }' -F owner=TommyKammy -F name=codex-supervisor -F number=1349; npx tsx --test src/pull-request-state-policy.test.ts; npx tsx --test src/review-handling.test.ts; npx tsx --test src/supervisor/supervisor-pre-merge-evaluation.test.ts; npx tsc --noEmit
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
- 2026-04-08: Pushed `Make fix-blocked review gate explicit` as `00434db` to `codex/issue-1337`; PR #1349 now includes the explicit same-PR review-decision guard at the flagged `pull-request-state.ts` branch.
- 2026-04-08: Live GitHub thread query showed PRRT_kwDORgvdZ855fYSl still unresolved on head `88cc322`; added an explicit `reviewDecisionAllowsSamePrRepair(pr)` guard at the flagged `pull-request-state.ts` branch, reran focused policy/review/pre-merge tests plus `tsc`, and prepared a follow-up checkpoint for PR #1349.
- 2026-04-08: Committed `Honor review gates for fix-blocked repair` as `cb1dc21` and pushed `codex/issue-1337`; PR #1349 now carries the review-gate precedence fix plus focused regressions.
- 2026-04-08: Review pass found the two `.codex-supervisor/issues/1337/issue-journal.md` comments were stale because the journal already shows `addressing_review`; patched the live `fix_blocked` same-PR repair gate so `REVIEW_REQUIRED` blocks both state inference and pre-merge DTO repair labeling, and added focused regressions for the gated path.
- 2026-04-08: Focused verification rerun succeeded for `src/review-handling.test.ts`, `src/pull-request-state-policy.test.ts`, `src/post-turn-pull-request.test.ts`, `src/supervisor/supervisor-pre-merge-evaluation.test.ts`, `src/turn-execution-orchestration.test.ts`, `src/codex/codex-prompt.test.ts`, and `npx tsc --noEmit`; draft PR opened at #1349.
