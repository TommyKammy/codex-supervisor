# Issue #1148: Do not block auto-merge on resolved-state journal-only bot threads when PR is green

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1148
- Branch: codex/issue-1148
- Workspace: .
- Journal: .codex-supervisor/issues/1148/issue-journal.md
- Current phase: addressing_review
- Attempt count: 3 (implementation=2, repair=1)
- Last head SHA: 47ce0213c3e31bff32b764a700e321ed8bbb1d19
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ853bK_s|PRRT_kwDORgvdZ853bK_u|PRRT_kwDORgvdZ853bK_w
- Repeated failure signature count: 1
- Updated at: 2026-03-28T03:56:11.433Z

## Latest Codex Summary
Addressed the three open CodeRabbit review findings on PR [#1149](https://github.com/TommyKammy/codex-supervisor/pull/1149). The journal-only exception now only suppresses configured-bot thread blocking, `blockedReasonFromReviewState(...)` evaluates the real check set, and `configuredBotCurrentHeadStatusState` now only accepts CodeRabbit-specific status contexts.

Focused verification passed for the updated policy, signal-scoping, and post-turn blocker plumbing. Full repo-wide `npm test` still has not been run locally.

Summary: Fixed the three PR #1149 review findings, added regressions for human-review gating and CodeRabbit-only status scoping, and re-verified the touched flows locally.
State hint: addressing_review
Blocked reason: none
Tests: `npx tsx --test src/pull-request-state-policy.test.ts src/github/github-review-signals.test.ts`; `npm run build`; `npx tsx --test src/post-turn-pull-request.test.ts src/run-once-turn-execution.test.ts`
Next action: Commit and push the review-fix patch to `codex/issue-1148`, then wait for refreshed PR #1149 CI/review state.
Failure signature: PRRT_kwDORgvdZ853bK_s|PRRT_kwDORgvdZ853bK_u|PRRT_kwDORgvdZ853bK_w

## Active Failure Context
- Category: review
- Summary: 3 unresolved automated review thread(s) remain.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/1149#discussion_r3004098425
- Details:
  - src/github/github-review-signals.ts:443 summary=_⚠️ Potential issue_ | _🟠 Major_ **Scope `currentHeadStatusState` to the CodeRabbit status source.** `inferConfiguredBotCurrentHeadStatusState()` accepts any status context mat... url=https://github.com/TommyKammy/codex-supervisor/pull/1149#discussion_r3004098425
  - src/pull-request-state.ts:425 summary=_⚠️ Potential issue_ | _🔴 Critical_ **Keep human review decisions outside the journal-only exception.** Line 650 suppresses all `CHANGES_REQUESTED` handling when `journalOnlyCo... url=https://github.com/TommyKammy/codex-supervisor/pull/1149#discussion_r3004098427
  - src/pull-request-state.ts:515 summary=_⚠️ Potential issue_ | _🟠 Major_ **Don't manufacture passing checks in `blockedReasonFromReviewState`.** These calls pass `[]` into `effectiveConfiguredBotReviewThreads(...)` a... url=https://github.com/TommyKammy/codex-supervisor/pull/1149#discussion_r3004098429

## Codex Working Notes
### Current Handoff
- Hypothesis: The remaining review blocker was caused by the new exception bypassing broader review gates and by blocker evaluation treating an empty check list as green.
- What changed: Kept the journal-only exception limited to configured-bot thread filtering, removed its bypass of `CHANGES_REQUESTED`/merge-readiness gates, threaded real `checks` into `blockedReasonFromReviewState(...)`, scoped `configuredBotCurrentHeadStatusState` to CodeRabbit-specific statuses, and added focused regressions for the allowed journal-only case, the human-review gate, and mixed-bot status contexts.
- Current blocker: none
- Next exact step: Push the review-fix commit to PR #1149 and re-check CI/review threads on the new head.
- Verification gap: Full repo-wide `npm test` has not been run locally; only the touched policy/signal/post-turn slices plus `npm run build` were re-run this turn.
- Files touched: src/pull-request-state.ts; src/pull-request-state-policy.test.ts; src/github/github-review-signals.ts; src/github/github-review-signals.test.ts; src/post-turn-pull-request.ts; src/run-once-turn-execution.ts; src/supervisor/supervisor-lifecycle.ts; src/supervisor/supervisor.ts; .codex-supervisor/issues/1148/issue-journal.md
- Rollback concern: If the new CodeRabbit-only status scoping is too narrow for repos with atypical CodeRabbit status metadata, the exception could stop unlocking even when CodeRabbit is green.
- Last focused command: npx tsx --test src/post-turn-pull-request.test.ts src/run-once-turn-execution.test.ts
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
- 2026-03-28: Addressed CodeRabbit review findings by preserving human review gates, passing real checks into blocker evaluation, and scoping current-head status state to CodeRabbit-only contexts.
- 2026-03-28: Verification passed: `npx tsx --test src/pull-request-state-policy.test.ts src/github/github-review-signals.test.ts`, `npm run build`, and `npx tsx --test src/post-turn-pull-request.test.ts src/run-once-turn-execution.test.ts`.
- 2026-03-28: Focused verification passed: `npx tsx --test src/pull-request-state-policy.test.ts src/github/github-review-signals.test.ts`, `npx tsx --test src/pull-request-state-thread-reprocessing.test.ts src/github/github-pull-request-hydrator.test.ts`, and `npm run build`.
- 2026-03-28: Pushed branch `codex/issue-1148` and opened draft PR `#1149` -> https://github.com/TommyKammy/codex-supervisor/pull/1149
