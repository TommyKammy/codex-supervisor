# Issue #938: Manual-verification UI issues can stall without explicit blocked state

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/938
- Branch: codex/issue-938
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: stabilizing
- Attempt count: 2 (implementation=2, repair=0)
- Last head SHA: eacef0c87bca5db490b37e0cd1dc21c273c1620c
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-24T09:17:17Z

## Latest Codex Summary
Updated the late-stage manual-verification path so a current-head `manual_review_blocked` outcome now converges to an explicit `state=blocked` / `blocked_reason=manual_review` instead of lingering in `draft_pr`. The change is in [post-turn-pull-request.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-938/src/post-turn-pull-request.ts), [pull-request-state.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-938/src/pull-request-state.ts), and [review-handling.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-938/src/review-handling.ts). I also added focused regressions in [post-turn-pull-request.test.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-938/src/post-turn-pull-request.test.ts) and [pull-request-state-policy.test.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-938/src/pull-request-state-policy.test.ts), updated the journal, and committed the checkpoint as `eacef0c` (`Block manual-review-gated draft PRs explicitly`).

Verification here:
`npx tsx --test src/post-turn-pull-request.test.ts src/pull-request-state-policy.test.ts`
`npx tsx --test src/post-turn-pull-request.test.ts src/pull-request-state-policy.test.ts src/supervisor/supervisor-recovery-reconciliation.test.ts src/supervisor/supervisor-selection-status-active-status.test.ts src/supervisor/supervisor-status-rendering.test.ts`
`npm run build`
`node dist/index.js status --config <temp>/supervisor.config.json`

Summary: Explicitly block manual-review-gated draft/current-head PR states, confirm the supervisor-level reconciliation/status slice stays green, and verify the built CLI now renders `state=blocked` with `blocked_reason=manual_review`
State hint: stabilizing
Blocked reason: none
Tests: `npx tsx --test src/post-turn-pull-request.test.ts src/pull-request-state-policy.test.ts`; `npx tsx --test src/post-turn-pull-request.test.ts src/pull-request-state-policy.test.ts src/supervisor/supervisor-recovery-reconciliation.test.ts src/supervisor/supervisor-selection-status-active-status.test.ts src/supervisor/supervisor-status-rendering.test.ts`; `npm run build`; `node dist/index.js status --config <temp>/supervisor.config.json`
Next action: monitor draft PR #940 and let the supervisor observe the explicit `manual_review` block through normal status/CI flows
Failure signature: none

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: `manual_review_blocked` was typed and surfaced in pre-merge artifacts, but the draft-PR lifecycle still treated it like a runnable late-stage state, leaving `state=draft_pr` and `blocked_reason=null` instead of recording an explicit manual-review block.
- What changed: added a focused reproducer in `src/post-turn-pull-request.test.ts` for a draft PR whose local review requires manual verification; added state-policy coverage in `src/pull-request-state-policy.test.ts`; introduced `localReviewRequiresManualReview()` in `src/review-handling.ts`; updated `src/post-turn-pull-request.ts` and `src/pull-request-state.ts` so current-head `manual_review_blocked` outcomes converge to `state=blocked` with `blocked_reason=manual_review` and do not promote draft PRs to ready.
- Current blocker: none.
- Next exact step: monitor draft PR #940, then let the supervisor observe the explicit `manual_review` blocked state through normal PR/status flows.
- Verification gap: acceptance-level merge/manual-close convergence is still exercised by existing reconciliation coverage rather than a new end-to-end CLI script, but the targeted reconciliation/status tests and a real built `status --config` invocation are green locally.
- Files touched: `src/post-turn-pull-request.ts`, `src/post-turn-pull-request.test.ts`, `src/pull-request-state.ts`, `src/pull-request-state-policy.test.ts`, `src/review-handling.ts`, `.codex-supervisor/issue-journal.md`
- Rollback concern: low; reverting would restore the ambiguous draft/manual-verification stall and make UI-heavy issues look runnable when they actually need operator verification.
- Last focused command: `node dist/index.js status --config <temp>/supervisor.config.json`
- Last focused failure: none
- Draft PR: #940 https://github.com/TommyKammy/codex-supervisor/pull/940
- Last focused commands:
```bash
git status --short
git branch -vv
gh pr list --head codex/issue-938 --json number,title,state,isDraft,url
sed -n '1,260p' src/supervisor/supervisor-recovery-reconciliation.test.ts
sed -n '240,380p' src/supervisor/supervisor-selection-status-active-status.test.ts
sed -n '1,220p' src/supervisor/supervisor-status-rendering.test.ts
npx tsx --test src/post-turn-pull-request.test.ts src/pull-request-state-policy.test.ts src/supervisor/supervisor-recovery-reconciliation.test.ts src/supervisor/supervisor-selection-status-active-status.test.ts src/supervisor/supervisor-status-rendering.test.ts
npm run build
node dist/index.js status --config <temp>/supervisor.config.json
```
### Scratchpad
- Leave `.codex-supervisor/replay/` untracked; it is local replay output, not part of the fix.
