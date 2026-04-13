# Issue #1485: Bug: reviewThreads GraphQL surface can be truncated at 64KB and crash tracked PR reconciliation

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1485
- Branch: codex/issue-1485
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: d3b1ae7e27271c1175a1b4dfb66706d97a3d4487
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-04-13T16:55:38.364Z

## Latest Codex Summary
- Added focused regressions proving large GraphQL JSON payloads were being locally truncated before JSON parsing in both `reviewThreads` reconciliation and the sibling PR hydrator path.
- Routed machine-readable GitHub JSON calls in `GitHubReviewSurfaceClient` and `GitHubPullRequestHydrator` through unbounded stdout capture while leaving the command runner default bounded capture unchanged.
- Verified with focused GitHub tests, command-runner tests, and a full TypeScript build.

## Active Failure Context
- Reproduced pre-fix failure as `reviewthreads-json-truncated-64kb` with: `Failed to parse JSON from gh api graphql reviewThreads pr=443: Bad control character in string literal in JSON at position 32766`.

## Codex Working Notes
### Current Handoff
- Hypothesis: tracked PR reconciliation was parsing bounded stdout from `gh` as if it were complete JSON; any GraphQL review payload above 64KB would be truncated locally and crash parse.
- What changed: added large-payload regressions; introduced `runGhJsonCommand(..., { stdoutCaptureLimitBytes: null })` helpers in `src/github/github-review-surface.ts` and `src/github/github-pull-request-hydrator.ts`; moved structural JSON fetches in those files to the unbounded path.
- Current blocker: none.
- Next exact step: commit the fix and, if branch policy still expects early publication, open a draft PR from `codex/issue-1485`.
- Verification gap: none for the requested local scope; CI has not run yet.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/github/github-review-surface.ts`, `src/github/github-pull-request-hydrator.ts`, `src/github/github.test.ts`, `src/github/github-pull-request-hydrator.test.ts`.
- Rollback concern: low; scope is limited to machine-readable GitHub JSON callers and preserves bounded capture for human-oriented command output.
- Last focused command: `npm run build`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
