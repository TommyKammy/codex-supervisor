# Issue #1337: Enhancement: auto-repair current-head fix_blocked local-review findings on tracked PRs

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1337
- Branch: codex/issue-1337
- Workspace: .
- Journal: .codex-supervisor/issues/1337/issue-journal.md
- Current phase: addressing_review
- Attempt count: 4 (implementation=3, repair=1)
- Last head SHA: 307dd0c156ad34e4ff207f8abd0d8fbf06bb74c6
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ855fYSU|PRRT_kwDORgvdZ855fYSe|PRRT_kwDORgvdZ855fYSl|PRRT_kwDORgvdZ855fYSn
- Repeated failure signature count: 1
- Updated at: 2026-04-08T07:42:09.746Z

## Latest Codex Summary
The branch already had a coherent fix committed and pushed at `307dd0c` (`Handle current-head fix_blocked same-PR repair`). I validated that checkpoint with focused coverage for the changed repair/state/prompt/pre-merge paths plus `tsc`, then opened draft PR [#1349](https://github.com/TommyKammy/codex-supervisor/pull/1349).

I also updated the issue journal’s Codex Working Notes with the verified state, commands run, and the next supervisor-facing action. The only remaining local dirt is supervisor runtime/journal state under `.codex-supervisor/`; no additional product code changes were needed this turn.

Summary: Verified the existing fix checkpoint for issue #1337, opened draft PR #1349, and updated the issue journal for supervisor handoff.
State hint: draft_pr
Blocked reason: none
Tests: npx tsx --test src/review-handling.test.ts; npx tsx --test src/pull-request-state-policy.test.ts; npx tsx --test src/post-turn-pull-request.test.ts; npx tsx --test src/supervisor/supervisor-pre-merge-evaluation.test.ts; npx tsx --test src/turn-execution-orchestration.test.ts; npx tsx --test src/codex/codex-prompt.test.ts; npx tsc --noEmit
Next action: Let the supervisor pick up draft PR #1349 and proceed with CI/local-review monitoring or review feedback handling.
Failure signature: PRRT_kwDORgvdZ855fYSU|PRRT_kwDORgvdZ855fYSe|PRRT_kwDORgvdZ855fYSl|PRRT_kwDORgvdZ855fYSn

## Active Failure Context
- Category: review
- Summary: 4 unresolved automated review thread(s) remain.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/1349#discussion_r3049860186
- Details:
  - .codex-supervisor/issues/1337/issue-journal.md:8 summary=_⚠️ Potential issue_ | _🟡 Minor_ **Update the phase value to reflect current state.** The phase is listed as `"reproducing"` but the PR description indicates implementation is ... url=https://github.com/TommyKammy/codex-supervisor/pull/1349#discussion_r3049860186
  - .codex-supervisor/issues/1337/issue-journal.md:27 summary=_⚠️ Potential issue_ | _🟡 Minor_ **Update the next step to reflect PR `#1349` is already open.** The journal states the next step is to "open/update the draft PR," but accordin... url=https://github.com/TommyKammy/codex-supervisor/pull/1349#discussion_r3049860196
  - src/pull-request-state.ts:896 summary=_⚠️ Potential issue_ | _🟠 Major_ **Honor `REVIEW_REQUIRED` before entering the new fix-blocked repair lane.** Line 888 only checks CI/thread/conflict cleanliness, so a current-... url=https://github.com/TommyKammy/codex-supervisor/pull/1349#discussion_r3049860205
  - src/supervisor/supervisor-pre-merge-evaluation.ts:124 summary=_⚠️ Potential issue_ | _🟠 Major_ **Keep the pre-merge DTO aligned with live review-gate precedence.** Lines 120-124 can still emit `same_pr_fix_blocked_current_head` whenever t... url=https://github.com/TommyKammy/codex-supervisor/pull/1349#discussion_r3049860208

## Codex Working Notes
### Current Handoff
- Hypothesis: The remaining valid review feedback was that current-head `fix_blocked` repair still ignored live GitHub review gates in two places: pull-request state inference and pre-merge repair labeling. The two issue-journal comments were stale because the live journal already reflected `addressing_review` and an open PR.
- What changed: Reused a shared same-PR repair review-decision predicate for `fix_blocked` and manual-review repair checks, prevented `REVIEW_REQUIRED` from entering `local_review_fix` for current-head `fix_blocked` residuals, suppressed `same_pr_fix_blocked_current_head` and `high_severity_retry_current_head` labels when the live review gate blocks same-PR repair, and added focused regressions for the helper, policy, and pre-merge DTO paths.
- Current blocker: automated review threads remain open on PR #1349 until this checkpoint is pushed and re-reviewed.
- Next exact step: Commit and push the review-gate precedence fix on `codex/issue-1337`, then refresh PR #1349 for re-review.
- Verification gap: Full `npm test` wrapper was not used for signal because it runs unrelated suites and previously hit an existing unrelated browser-helper failure; the focused `tsx --test` suites for the changed behavior and `tsc --noEmit` are green.
- Files touched: src/review-handling.ts; src/review-handling.test.ts; src/pull-request-state.ts; src/pull-request-state-policy.test.ts; src/post-turn-pull-request.test.ts; src/supervisor/supervisor-pre-merge-evaluation.ts; src/supervisor/supervisor-pre-merge-evaluation.test.ts; src/turn-execution-orchestration.ts; src/codex/codex-prompt.ts
- Rollback concern: Low; behavior change is intentionally limited to current-head `fix_blocked` residuals on otherwise clean tracked PR lanes, but reverting should keep the helper/state/prompt/DTO changes together.
- Last focused command: npx tsx --test src/review-handling.test.ts; npx tsx --test src/pull-request-state-policy.test.ts; npx tsx --test src/supervisor/supervisor-pre-merge-evaluation.test.ts; npx tsc --noEmit
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
- 2026-04-08: Review pass found the two `.codex-supervisor/issues/1337/issue-journal.md` comments were stale because the journal already shows `addressing_review`; patched the live `fix_blocked` same-PR repair gate so `REVIEW_REQUIRED` blocks both state inference and pre-merge DTO repair labeling, and added focused regressions for the gated path.
- 2026-04-08: Focused verification rerun succeeded for `src/review-handling.test.ts`, `src/pull-request-state-policy.test.ts`, `src/post-turn-pull-request.test.ts`, `src/supervisor/supervisor-pre-merge-evaluation.test.ts`, `src/turn-execution-orchestration.test.ts`, `src/codex/codex-prompt.test.ts`, and `npx tsc --noEmit`; draft PR opened at #1349.
