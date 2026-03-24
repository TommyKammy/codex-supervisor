# Issue #938: Manual-verification UI issues can stall without explicit blocked state

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/938
- Branch: codex/issue-938
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 1f68f280a6e8ae44c558ccc09a96bd42e652cbf9
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-24T08:54:02.143Z

## Latest Codex Summary
- Reproduced the UI/manual-verification stall as a draft PR path: a `block_merge` local-review outcome of `manual_review_blocked` stayed in `draft_pr` with no explicit manual block, so the issue looked active instead of clearly blocked.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: `manual_review_blocked` was typed and surfaced in pre-merge artifacts, but the draft-PR lifecycle still treated it like a runnable late-stage state, leaving `state=draft_pr` and `blocked_reason=null` instead of recording an explicit manual-review block.
- What changed: added a focused reproducer in `src/post-turn-pull-request.test.ts` for a draft PR whose local review requires manual verification; added state-policy coverage in `src/pull-request-state-policy.test.ts`; introduced `localReviewRequiresManualReview()` in `src/review-handling.ts`; updated `src/post-turn-pull-request.ts` and `src/pull-request-state.ts` so current-head `manual_review_blocked` outcomes converge to `state=blocked` with `blocked_reason=manual_review` and do not promote draft PRs to ready.
- Current blocker: none.
- Next exact step: run a slightly broader supervisor-adjacent verification slice, then commit this reproducer-plus-fix checkpoint and open/update the draft PR if needed.
- Verification gap: broader reconciliation/status integration coverage still worth running, but the focused reproducer and state-policy regression tests are green locally.
- Files touched: `src/post-turn-pull-request.ts`, `src/post-turn-pull-request.test.ts`, `src/pull-request-state.ts`, `src/pull-request-state-policy.test.ts`, `src/review-handling.ts`, `.codex-supervisor/issue-journal.md`
- Rollback concern: low; reverting would restore the ambiguous draft/manual-verification stall and make UI-heavy issues look runnable when they actually need operator verification.
- Last focused command: `npx tsx --test src/post-turn-pull-request.test.ts src/pull-request-state-policy.test.ts`
- Last focused failure: reproduced before the fix as `draft_pr-manual-review-stall`
- Draft PR: none
- Last focused commands:
```bash
sed -n '1,240p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-938/AGENTS.generated.md
sed -n '1,240p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-938/context-index.md
sed -n '1,320p' .codex-supervisor/issue-journal.md
git status --short
rg -n "manual verification|manual_review|manual_review_blocked|blocked_reason|draft_pr|pr_open|visual verification|browser verification" src docs README.md
sed -n '620,820p' src/supervisor/supervisor-recovery-reconciliation.test.ts
sed -n '634,860p' src/recovery-reconciliation.ts
sed -n '1051,1225p' src/recovery-reconciliation.ts
sed -n '1,90p' src/review-handling.ts
sed -n '80,150p' src/review-handling.ts
sed -n '430,520p' src/pull-request-state.ts
sed -n '569,720p' src/pull-request-state.ts
sed -n '240,560p' src/post-turn-pull-request.ts
sed -n '220,360p' src/post-turn-pull-request.test.ts
npx tsx --test src/post-turn-pull-request.test.ts
npx tsx --test src/post-turn-pull-request.test.ts src/pull-request-state-policy.test.ts
```
### Scratchpad
- Leave `.codex-supervisor/replay/` untracked; it is local replay output, not part of the fix.
