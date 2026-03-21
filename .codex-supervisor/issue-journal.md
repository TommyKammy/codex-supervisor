# Issue #769: Merge-ready recheck cadence: keep ready_to_merge on the faster merge-critical schedule

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/769
- Branch: codex/issue-769
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: c187072cebeff76a4b7e805015a414efa8ebdc44
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-21T11:14:50Z

## Latest Codex Summary
Added the missing `ready_to_merge` fast recheck coverage and widened the merge-critical cadence selector so the active issue keeps the short cadence in both `waiting_ci` and `ready_to_merge`, while blocked and non-merge-critical states still use the general poll interval.

Focused verification passed for the lifecycle reproducer and the issue-targeted supervisor suites. `npm run build` also passed after restoring the local dev dependencies with `npm ci` because this worktree initially had no `node_modules/.bin/tsc`.

Summary: Extended merge-critical recheck cadence through `ready_to_merge`, added the focused reproducer, and verified the targeted suites plus build
State hint: implementing
Blocked reason: none
Tests: `npx tsx --test src/supervisor/supervisor-lifecycle.test.ts`; `npx tsx --test src/supervisor/supervisor-pr-readiness.test.ts src/supervisor/supervisor-execution-orchestration.test.ts`; `npm run build`
Failure signature: none
Next action: commit the issue-769 cadence fix, push `codex/issue-769`, and open a draft PR

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the remaining issue-769 gap was that the merge-critical cadence selector still only recognized `waiting_ci`, so `ready_to_merge` silently fell back to the coarse poll interval despite current-head merge progress.
- What changed: added a focused lifecycle test that reproduces the `ready_to_merge` cadence miss, then widened the selector to allow the same fast cadence for `ready_to_merge` while preserving the existing blocked-state and non-merge-critical guards.
- Current blocker: none
- Next exact step: commit and push the issue-769 fix on `codex/issue-769`, then open a draft PR because no branch PR exists yet.
- Verification gap: none in the targeted suites or build; `.codex-supervisor/replay/` remains untracked and untouched.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/supervisor/supervisor-lifecycle.test.ts`, `src/supervisor/supervisor-lifecycle.ts`
- Rollback concern: narrowing the cadence back to `waiting_ci` would reintroduce avoidable idle time after a PR is already merge-ready.
- Last focused command: `npm run build`
- Last focused failure: `cadence-ready-to-merge`
- Last focused commands:
```bash
npx tsx --test src/supervisor/supervisor-lifecycle.test.ts
npx tsx --test src/supervisor/supervisor-pr-readiness.test.ts src/supervisor/supervisor-execution-orchestration.test.ts
npm ci
npm run build
```
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
