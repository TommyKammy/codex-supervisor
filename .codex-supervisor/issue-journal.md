# Issue #1472: Bug: blocked stale_review_bot tracked PRs are never revisited after enabling reply_and_resolve

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1472
- Branch: codex/issue-1472
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 2 (implementation=1, repair=1)
- Last head SHA: 1deceebd33cb7cf65586d7879466f4c9b76a3e31
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ856c-Kd|PRRT_kwDORgvdZ856c-Kj
- Repeated failure signature count: 1
- Updated at: 2026-04-13T07:16:36.528Z

## Latest Codex Summary
Addressed the two automated review threads on top of the original stale-review-bot recovery change. The main fix is in `src/run-once-cycle-prelude.ts`: degraded inventory continuation now still runs tracked blocked-PR reconciliation for `stale_review_bot` records when the configured policy makes them auto-recoverable, via the same `shouldAutoRecoverStaleReviewBot()` predicate used by reconciliation. `src/supervisor/supervisor.ts` now passes that policy-aware predicate into the prelude so the gate stays aligned with the existing recovery rules instead of broadening degraded retries globally.

I also tightened the regression coverage the review asked for. `src/run-once-cycle-prelude.test.ts` now proves degraded continuation invokes blocked tracked-PR reconciliation for an auto-recoverable `stale_review_bot` record, and `src/supervisor/supervisor-recovery-reconciliation.test.ts` normalizes the inherited head-scoped review fields to the current head so the same-head resume test no longer passes through stale-head fixture baggage.

Summary: Fixed the degraded-continuation gate for auto-recoverable `stale_review_bot` tracked PRs, tightened the same-head stale-review regression fixture, and verified the updated branch locally.
State hint: addressing_review
Blocked reason: none
Tests: `npx tsx --test src/post-turn-pull-request.test.ts src/run-once-cycle-prelude.test.ts src/supervisor/supervisor-execution-policy.test.ts src/supervisor/supervisor-diagnostics-explain.test.ts src/supervisor/supervisor-recovery-reconciliation.test.ts`; `npm run build`
Next action: Commit and push the review-fix delta to PR `#1473`, then refresh review state for the unresolved automated threads.
Failure signature: PRRT_kwDORgvdZ856c-Kd|PRRT_kwDORgvdZ856c-Kj

## Active Failure Context
- Category: review
- Summary: 2 unresolved automated review thread(s) remain.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/1473#discussion_r3071387483
- Details:
  - src/recovery-reconciliation.ts:1030 summary=_⚠️ Potential issue_ | _🟠 Major_ 🧩 Analysis chain 🏁 Script executed: Repository: TommyKammy/codex-supervisor Length of output: 50384 --- 🏁 Script executed: Repository: Tommy... url=https://github.com/TommyKammy/codex-supervisor/pull/1473#discussion_r3071387483
  - src/supervisor/supervisor-recovery-reconciliation.test.ts:2052 summary=_⚠️ Potential issue_ | _🟡 Minor_ **Tighten this regression to the intended same-head recovery path.** `createTrackedPrStaleReviewRecord()` still brings along head-scoped review... url=https://github.com/TommyKammy/codex-supervisor/pull/1473#discussion_r3071387489

## Codex Working Notes
### Current Handoff
- Hypothesis: the stale configured-bot reply/resolve handler already works in `post-turn`, but supervisor selection/recovery treated `blocked_reason=stale_review_bot` as a permanent manual block, so already-blocked tracked PR incidents never re-entered that handler after the policy changed.
- What changed this turn: fixed the degraded inventory-refresh prelude gate so it still calls `reconcileRecoverableBlockedIssueStates(..., { onlyTrackedPrStates: true })` for `stale_review_bot` tracked PR records when `shouldAutoRecoverStaleReviewBot(record, config)` is true; passed that predicate from `src/supervisor/supervisor.ts`; added a prelude regression test; normalized same-head stale-review fixture fields in the reconciliation test.
- Current blocker: none.
- Next exact step: commit the focused review-fix delta, push `codex/issue-1472`, and let the supervisor/PR loop re-evaluate the remaining review-thread state.
- Verification gap: full `npm test -- <file>` still pulls unrelated suite-wide failures in this repo, so focused verification used `npx tsx --test` with the exact requested files instead.
- Files touched this turn: `.codex-supervisor/issue-journal.md`, `src/run-once-cycle-prelude.ts`, `src/run-once-cycle-prelude.test.ts`, `src/supervisor/supervisor.ts`, `src/supervisor/supervisor-recovery-reconciliation.test.ts`.
- Rollback concern: low; the new recovery path is limited to tracked PR records already blocked as `stale_review_bot` and still defers actual reply/resolve safety checks to the existing post-turn stale-bot handler.
- Last focused command: `npx tsx --test src/post-turn-pull-request.test.ts src/run-once-cycle-prelude.test.ts src/supervisor/supervisor-execution-policy.test.ts src/supervisor/supervisor-diagnostics-explain.test.ts src/supervisor/supervisor-recovery-reconciliation.test.ts`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
