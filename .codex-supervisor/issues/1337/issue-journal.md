# Issue #1337: Enhancement: auto-repair current-head fix_blocked local-review findings on tracked PRs

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1337
- Branch: codex/issue-1337
- Workspace: .
- Journal: .codex-supervisor/issues/1337/issue-journal.md
- Current phase: addressing_review
- Attempt count: 6 (implementation=3, repair=1)
- Last head SHA: 387fd53b89db734e1bf6bc17f74edd05547a765d
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ855fmLT
- Repeated failure signature count: 1
- Updated at: 2026-04-08T07:59:05.073Z

## Latest Codex Summary
Made the review-thread follow-up explicit in [src/pull-request-state.ts](src/pull-request-state.ts): the `fix_blocked` `local_review_fix` branch now also checks `reviewDecisionAllowsSamePrRepair(pr)` at the call site, not just inside the helper. That preserves behavior but makes the required-review gate obvious on the exact branch CodeRabbit flagged.

I also updated [issue-journal.md](.codex-supervisor/issues/1337/issue-journal.md), committed the follow-up as `00434db` and the final journal sync as `387fd53`, and pushed both to `codex/issue-1337` / PR #1349. Focused local verification is green. Live PR status now shows head `387fd53` with both CI builds in progress; the CodeRabbit thread `PRRT_kwDORgvdZ855fYSl` is still unresolved on GitHub and needs a refresh/re-review rather than another local code change right now.

Summary: Made the `REVIEW_REQUIRED` same-PR repair gate explicit in `pull-request-state.ts`, updated the issue journal, and pushed commits `00434db` and `387fd53` to PR #1349.
State hint: waiting_ci
Blocked reason: none
Tests: `npx tsx --test src/pull-request-state-policy.test.ts`; `npx tsx --test src/review-handling.test.ts`; `npx tsx --test src/supervisor/supervisor-pre-merge-evaluation.test.ts`; `npx tsc --noEmit`
Next action: Wait for PR #1349 CI and CodeRabbit to refresh on head `387fd53`, then re-check whether thread `PRRT_kwDORgvdZ855fYSl` resolves or needs another targeted follow-up.
Failure signature: PRRT_kwDORgvdZ855fmLT

## Active Failure Context
- Category: review
- Summary: 1 unresolved automated review thread(s) remain.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/1349#discussion_r3049937293
- Details:
  - src/review-handling.ts:287 summary=_⚠️ Potential issue_ | _🟠 Major_ **Preserve the review-gate precedence in the retry loop.** For a current-head `fix_blocked` result with `local_review_verified_max_severity ===... url=https://github.com/TommyKammy/codex-supervisor/pull/1349#discussion_r3049937293

## Codex Working Notes
### Current Handoff
- Hypothesis: The remaining CodeRabbit thread is valid because `localReviewRetryLoopCandidate()` still treated `fix_blocked` and verifier-confirmed `high` severity as independent OR-branches, which let `localReviewHighSeverityNeedsRetry()` re-enter same-PR repair even when `REVIEW_REQUIRED` or `CHANGES_REQUESTED` should stop the lane.
- What changed: Reordered the retry-loop precedence in `src/review-handling.ts` so current-head `fix_blocked`, manual-review repair, and follow-up repair are evaluated before high-severity retry, and the high-severity path is skipped entirely for `fix_blocked` outcomes. Added a focused regression covering `fix_blocked` plus `local_review_verified_max_severity="high"` under both `REVIEW_REQUIRED` and `CHANGES_REQUESTED`.
- Current blocker: none locally; awaiting refreshed GitHub review state for PR #1349 once this retry-loop fix is on the branch.
- Next exact step: Re-check PR #1349 review threads and CI after pushing the retry-loop precedence fix to confirm the remaining CodeRabbit thread becomes stale or otherwise needs no further code change.
- Verification gap: Full `npm test` wrapper was not used because this repair is isolated to review-lane backend logic and prior full-wrapper runs hit unrelated browser-helper failures; focused review/state/pre-merge tests plus `tsc --noEmit` are green.
- Files touched: src/review-handling.ts; src/review-handling.test.ts; .codex-supervisor/issues/1337/issue-journal.md
- Rollback concern: Low; the change narrows retry eligibility for `fix_blocked` outcomes to preserve the issue’s documented review-gate precedence and is covered by targeted regression tests.
- Last focused command: gh auth status; gh pr view 1349 --json number,url,isDraft,reviewDecision,mergeStateStatus,headRefOid,headRefName,statusCheckRollup; gh api graphql -f query='query($owner:String!, $name:String!, $number:Int!) { repository(owner:$owner, name:$name) { pullRequest(number:$number) { reviewThreads(first:50) { nodes { id isResolved isOutdated path line comments(last:1) { nodes { id url body author { login } createdAt } } } } } } }' -F owner=TommyKammy -F name=codex-supervisor -F number=1349; npx tsx --test src/review-handling.test.ts; npx tsx --test src/pull-request-state-policy.test.ts; npx tsx --test src/supervisor/supervisor-pre-merge-evaluation.test.ts; npx tsc --noEmit
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
- 2026-04-08: Patched `localReviewRetryLoopCandidate()` so `fix_blocked` outcomes cannot bypass `REVIEW_REQUIRED` / `CHANGES_REQUESTED` through `localReviewHighSeverityNeedsRetry()`, and added a regression covering both review decisions when verifier-confirmed severity is `high`.
- 2026-04-08: Pushed `Make fix-blocked review gate explicit` as `00434db` to `codex/issue-1337`; PR #1349 now includes the explicit same-PR review-decision guard at the flagged `pull-request-state.ts` branch.
- 2026-04-08: Live GitHub thread query showed PRRT_kwDORgvdZ855fYSl still unresolved on head `88cc322`; added an explicit `reviewDecisionAllowsSamePrRepair(pr)` guard at the flagged `pull-request-state.ts` branch, reran focused policy/review/pre-merge tests plus `tsc`, and prepared a follow-up checkpoint for PR #1349.
- 2026-04-08: Committed `Honor review gates for fix-blocked repair` as `cb1dc21` and pushed `codex/issue-1337`; PR #1349 now carries the review-gate precedence fix plus focused regressions.
- 2026-04-08: Review pass found the two `.codex-supervisor/issues/1337/issue-journal.md` comments were stale because the journal already shows `addressing_review`; patched the live `fix_blocked` same-PR repair gate so `REVIEW_REQUIRED` blocks both state inference and pre-merge DTO repair labeling, and added focused regressions for the gated path.
- 2026-04-08: Focused verification rerun succeeded for `src/review-handling.test.ts`, `src/pull-request-state-policy.test.ts`, `src/post-turn-pull-request.test.ts`, `src/supervisor/supervisor-pre-merge-evaluation.test.ts`, `src/turn-execution-orchestration.test.ts`, `src/codex/codex-prompt.test.ts`, and `npx tsc --noEmit`; draft PR opened at #1349.
