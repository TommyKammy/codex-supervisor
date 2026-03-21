# Issue #737: Hydration consumer split: separate informational PR hydration from action-taking reads

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/737
- Branch: codex/issue-737
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 2a2663f8cc327b2d4c1756d1637feb3fd0e0787b
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-21T09:09:33+09:00

## Latest Codex Summary
- None yet.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the narrowest safe split is to keep branch/status discovery on cached hydration while forcing action-oriented direct PR reads through an explicitly fresh hydrator path.
- What changed: added explicit `hydrateForStatus` and `hydrateForAction` paths in the PR hydrator, routed `resolvePullRequestForBranch`/branch discovery through the status path, and routed `getPullRequest` through the action path. Added focused client tests proving repeated action reads stay `fresh` while informational reads reuse cached hydration.
- Current blocker: none
- Next exact step: commit the hydration consumer split checkpoint, then open or update the draft PR for issue #737.
- Verification gap: the issue guidance references `src/pull-request-state.test.ts`, but that file does not exist in this worktree; I verified the split with `src/github/github.test.ts` plus the listed hydrator/lifecycle suites instead.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/github/github-pull-request-hydrator.ts`, `src/github/github.ts`, `src/github/github.test.ts`
- Rollback concern: collapsing the two hydrator entry points back into one would reintroduce cached reads on post-turn action paths and remove the explicit seam needed for later freshness tightening.
- Last focused command: `npm run build`
- Last focused failure: `GitHubClient getPullRequest does not reuse cached hydration for action reads` failed with `'cached' !== 'fresh'` before the split.
- Last focused commands:
```bash
sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-737/AGENTS.generated.md
sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-737/context-index.md
sed -n '1,260p' .codex-supervisor/issue-journal.md
rg -n "hydrate|hydration|pull request hydrator|HydratedPullRequest|hydrationProvenance" src
sed -n '1,240p' src/github/github.ts
sed -n '90,170p' src/github/github-pull-request-hydrator.ts
sed -n '1,260p' src/github/github.test.ts
npx tsx --test src/github/github.test.ts
npx tsx --test src/github/github-pull-request-hydrator.test.ts src/supervisor/supervisor-lifecycle.test.ts src/github/github.test.ts
npm ci
npm run build
```
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
