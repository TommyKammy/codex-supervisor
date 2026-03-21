# Issue #738: Hydration freshness for transitions: require fresh PR reads for readiness and review-wait decisions

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/738
- Branch: codex/issue-738
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 06412e75f85ab23dfb283a5c3a3d615a3623bec7
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-21T00:43:32Z

## Latest Codex Summary
- Transition-driving PR reads now bypass same-head hydration cache while informational/status reads still reuse it.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: readiness and review-wait transitions should resolve branch PRs through an explicit action-purpose hydration path so same-head review-state changes are never hidden behind informational cache reuse.
- What changed: added a `purpose` selector to PR branch/tracked lookups in `GitHubClient`, kept status reads on cached hydration, and routed transition-driving `resolvePullRequestForBranch` calls in issue preparation and post-turn execution through `{ purpose: "action" }`. Added focused tests proving action-purpose branch reads stay `fresh` and that both preparation and post-turn execution request the action path.
- Current blocker: none
- Next exact step: commit this readiness/review-wait freshness checkpoint and open or update the draft PR for issue #738.
- Verification gap: the issue guidance references `src/pull-request-state.test.ts`, but that file does not exist in this worktree; I verified the transition freshness with the listed lifecycle/state suites plus focused preparation/turn execution coverage.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/github/github.ts`, `src/github/github.test.ts`, `src/run-once-issue-preparation.ts`, `src/run-once-issue-preparation.test.ts`, `src/run-once-turn-execution.ts`, `src/run-once-turn-execution.test.ts`
- Rollback concern: removing the action-purpose resolver or reverting its transition call sites would let same-head cached hydration hide newly arrived configured-bot review signals during readiness and review-wait decisions.
- Last focused command: `npm run build`
- Last focused failure: `npm run build` initially failed with `sh: 1: tsc: not found` before restoring dependencies with `npm ci`.
- Last focused commands:
```bash
sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-738/AGENTS.generated.md
sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-738/context-index.md
sed -n '1,260p' .codex-supervisor/issue-journal.md
rg -n "review-wait|readiness|ready|wait.*review|coderabbit|settled|getPullRequest\\(|resolvePullRequestForBranch|hydrateForAction|hydrateForStatus" src
sed -n '1,360p' src/post-turn-pull-request.ts
sed -n '340,470p' src/run-once-turn-execution.ts
sed -n '220,320p' src/run-once-issue-preparation.ts
npx tsx --test src/github/github.test.ts src/run-once-issue-preparation.test.ts src/run-once-turn-execution.test.ts
npm ci
npx tsx --test src/pull-request-state-coderabbit-settled-waits.test.ts src/supervisor/supervisor-lifecycle.test.ts src/github/github.test.ts src/run-once-issue-preparation.test.ts src/run-once-turn-execution.test.ts
npm run build
```
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
