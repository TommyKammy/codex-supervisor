# Issue #1083: Cache PR hydration and review-surface fetches by head SHA to cut GraphQL usage

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1083
- Branch: codex/issue-1083
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: d949080a8691b276cc87ddd4f4967e55577b7a43
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-26T18:05:53.404Z

## Latest Codex Summary
- Reproduced the remaining GraphQL churn in `GitHubClient`: same-head status reads still re-fetched unresolved review threads and external review surface because only PR hydration was cached. Added focused GitHub client regression tests, then cached status-purpose review-surface fetches by `prNumber + headSha + reviewSurfaceVersion` and wired the informational callers to pass `headRefOid` plus `updatedAt`/`createdAt`. Focused tests and `npm run build` now pass locally.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the remaining avoidable GraphQL usage comes from review-surface calls that sit outside the existing PR hydration cache. In particular, unresolved review threads and external review surface are re-fetched on repeated status/context reads even when the PR head and review-surface version are unchanged.
- What changed: added focused regressions in `src/github/github.test.ts` proving that same-head status reads re-fetched unresolved review threads and external review surface. Implemented a bounded `GitHubClient` cache for status-purpose review-surface GraphQL reads keyed by fetch kind, PR number, head SHA, and review-surface version. Wired `loadActiveIssueStatusSnapshot()` to reuse unresolved review threads for informational status reads, and wired `prepareCodexTurnPrompt()` to reuse external review surface for local-review context when the PR `headRefOid` and `updatedAt`/`createdAt` are unchanged.
- Current blocker: none locally.
- Next exact step: review the diff once more, then commit this cache slice as a checkpoint and decide whether a follow-up focused test around repeated active-status polling is worth adding before opening or updating the draft PR.
- Verification gap: I have not run the full repo suite; verification so far is the focused GitHub/status/orchestration tests plus a full TypeScript build.
- Files touched: `src/github/github.ts`; `src/github/github.test.ts`; `src/supervisor/supervisor-selection-active-status.ts`; `src/turn-execution-orchestration.ts`; `.codex-supervisor/issue-journal.md`.
- Rollback concern: low to moderate. The cache is limited to status-purpose reads and invalidates on head or review-surface version changes, but if GitHub ever stops updating `updatedAt` for a relevant review event this could retain stale informational context longer than intended.
- Last focused command: `npm run build`
- What changed this turn: reread the required memory files and current journal, identified that existing PR hydration caching did not cover unresolved review threads or external review surface, added focused failing tests, implemented a bounded status-only review-surface cache in `GitHubClient`, wired the informational callers to pass cache keys derived from `headRefOid` and `updatedAt`/`createdAt`, and reran focused verification plus a TypeScript build.
- Exact failure reproduced this turn: repeated same-head status reads called `getUnresolvedReviewThreads()` and `getExternalReviewSurface()` twice because those GraphQL surfaces had no cache even when the PR head and review-surface version were unchanged.
- Commands run this turn: `sed -n '1,220p' <redacted-local-path>`; `sed -n '1,220p' <redacted-local-path>`; `sed -n '1,260p' .codex-supervisor/issue-journal.md`; `git status --short`; `git branch --show-current`; `rg -n "head SHA|headSha|review-surface|review surface|hydrate|hydration|GraphQL|threads" src test docs`; `rg --files src test`; `sed -n '1,260p' src/github/github-pull-request-hydrator.ts`; `sed -n '740,980p' src/github/github.test.ts`; `sed -n '760,940p' src/github/github.ts`; `sed -n '1,220p' src/run-once-issue-preparation.ts`; `sed -n '220,620p' src/run-once-issue-preparation.ts`; `sed -n '1,260p' src/github/github-pull-request-hydrator.test.ts`; `sed -n '260,520p' src/github/github-pull-request-hydrator.test.ts`; `rg -n "getUnresolvedReviewThreads\\(|getExternalReviewSurface\\(" src`; `sed -n '680,840p' src/github/github.ts`; `sed -n '1,260p' src/external-review/external-review-signal-collection.ts`; `sed -n '100,220p' src/turn-execution-orchestration.ts`; `sed -n '460,560p' src/run-once-turn-execution.ts`; `sed -n '1040,1105p' src/recovery-reconciliation.ts`; `sed -n '1,120p' docs/architecture.md`; `sed -n '1,120p' docs/configuration.md`; `sed -n '1,120p' src/hydration-freshness-docs.test.ts`; `rg -n "getExternalReviewSurface|getUnresolvedReviewThreads" src/github/github.test.ts src/*test.ts`; `sed -n '1,280p' src/github/github.test.ts`; `sed -n '280,420p' src/github/github.test.ts`; `npm test -- src/github/github.test.ts`; `sed -n '1,220p' package.json`; `ls -1`; `test -d node_modules && echo yes || echo no`; `npm ci`; `npx tsx --test src/github/github.test.ts`; `sed -n '1,180p' src/supervisor/supervisor-selection-active-status.ts`; `sed -n '780,860p' src/supervisor/supervisor.ts`; `sed -n '220,320p' src/post-turn-pull-request.ts`; `rg -n "resolvePullRequestForBranch\\(|getPullRequestIfExists\\(|getPullRequest\\(" src/github/github.ts`; `sed -n '400,540p' src/github/github.ts`; `npx tsx --test src/github/github.test.ts src/turn-execution-orchestration.test.ts src/supervisor/supervisor-selection-status-active-status.test.ts`; `npm run build`; `date -u +"%Y-%m-%dT%H:%M:%SZ"`; `git status --short`; `sed -n '1,240p' .codex-supervisor/issue-journal.md`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
