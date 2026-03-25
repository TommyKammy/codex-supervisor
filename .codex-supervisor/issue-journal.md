# Issue #956: Artifact test isolation: standardize per-test temporary roots for artifact generation and persistence coverage

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/956
- Branch: codex/issue-956
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 4519e6a7fc7b57298bfe044d4992b7c705589b66
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-25T00:47:45.944Z

## Latest Codex Summary
- Standardized the scoped artifact-generation tests onto per-test temporary roots via `src/supervisor/artifact-test-helpers.ts`, added an isolation regression in `src/supervisor/post-merge-audit-artifact.test.ts`, and verified the requested test set plus `npm run build`.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: artifact persistence coverage was still vulnerable to stale files surviving prior test runs because some tests pointed `localReviewArtifactDir` at shared `os.tmpdir()` paths instead of a per-test root.
- What changed: added `src/supervisor/artifact-test-helpers.ts` with `createArtifactTestPaths(prefix)` to allocate isolated root/workspace/review paths per test; rewired `src/supervisor/execution-metrics-run-summary.test.ts`, `src/supervisor/post-merge-audit-artifact.test.ts`, and `src/supervisor/post-merge-audit-summary.test.ts` to use that helper; added a focused regression asserting distinct roots do not share stale review artifacts.
- Current blocker: none.
- Next exact step: stage the isolated-root test changes, commit them on `codex/issue-956`, then open or update the draft PR if the branch does not already have one.
- Verification gap: none in the requested scope; `npx tsx --test src/supervisor/execution-metrics-run-summary.test.ts src/supervisor/post-merge-audit-artifact.test.ts src/supervisor/post-merge-audit-summary.test.ts` and `npm run build` passed after restoring deps with `npm ci`.
- Files touched: `src/supervisor/artifact-test-helpers.ts`, `src/supervisor/execution-metrics-run-summary.test.ts`, `src/supervisor/post-merge-audit-artifact.test.ts`, `src/supervisor/post-merge-audit-summary.test.ts`, `.codex-supervisor/issue-journal.md`.
- Rollback concern: low; the change is test-only and isolated to temporary-path setup.
- Last focused command: `npm run build`
- PR status: no PR opened from `codex/issue-956` yet in this turn.
### Scratchpad
- Leave `.codex-supervisor/replay/` untracked; it is local replay output, not part of the fix.
