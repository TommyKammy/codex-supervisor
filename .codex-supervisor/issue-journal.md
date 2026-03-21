# Issue #739: Hydration freshness before merge: require a fresh PR read before merge-enabling actions

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/739
- Branch: codex/issue-739
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 8570eae969c78cdce22065c9f177538e53edc51e
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-21T01:13:56.047Z

## Latest Codex Summary
- Merge-enable actions now force a fresh PR read immediately before `enableAutoMerge`, and supervisor coverage includes a stale-head regression test for that last-step safeguard.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the final merge-enable action still trusts the previously carried PR snapshot, so same-number same-branch review/head changes can slip past if `enableAutoMerge` does not force one last authoritative PR hydration read.
- What changed: `Supervisor.handlePostTurnMergeAndCompletion` now re-reads the PR with `getPullRequest` immediately before calling `enableAutoMerge`. Added a focused regression test that passes a stale PR head into merge enablement and proves the fresh head SHA is used instead.
- Current blocker: none
- Next exact step: commit this merge-enable freshness checkpoint on `codex/issue-739`, then open or update the draft PR if needed.
- Verification gap: the issue guidance references `src/pull-request-state.test.ts`, but that file does not exist in this worktree; I verified the merge-enable freshness path with the focused supervisor readiness suite plus the requested lifecycle/hydrator suites.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/supervisor/supervisor.ts`, `src/supervisor/supervisor-pr-readiness.test.ts`
- Rollback concern: removing the last-moment `getPullRequest` refresh would let `enableAutoMerge` reuse a stale carried PR head and merge-authoritative review facts from an earlier snapshot.
- Last focused command: `npm run build`
- Last focused failure: `npm run build` failed with `sh: 1: tsc: not found` until restoring dependencies with `npm ci`.
- Last focused commands:
```bash
sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-739/AGENTS.generated.md
sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-739/context-index.md
sed -n '1,260p' .codex-supervisor/issue-journal.md
git status --short
rg -n "auto-merge|enable.*merge|merge-enabl|ready to merge|readiness-to-merge|enablePullRequestAutoMerge|merge.*action|hydrateForAction|resolvePullRequestForBranch|getPullRequest\\(" src
sed -n '360,470p' src/run-once-turn-execution.ts
sed -n '680,760p' src/supervisor/supervisor.ts
sed -n '1,260p' src/supervisor/supervisor-pr-readiness.test.ts
sed -n '520,760p' src/github/github.test.ts
sed -n '1,280p' src/post-turn-pull-request.ts
npx tsx --test src/supervisor/supervisor-pr-readiness.test.ts
npx tsx --test src/github/github-pull-request-hydrator.test.ts src/supervisor/supervisor-lifecycle.test.ts
npm ci
npx tsx --test src/supervisor/supervisor-pr-readiness.test.ts src/supervisor/supervisor-lifecycle.test.ts src/github/github-pull-request-hydrator.test.ts
npm run build
```
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
