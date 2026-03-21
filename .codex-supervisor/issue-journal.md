# Issue #778: Candidate discovery pagination: fetch matching open issues beyond the first 100 for runnable selection

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/778
- Branch: codex/issue-778
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: f26a201bc28c82ba162d47151a945d95a8cdf021
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-21T13:56:05.278Z

## Latest Codex Summary
- Reproduced the first-page-only discovery bug with a focused `src/github/github.test.ts` regression, switched candidate discovery to paginated matching-open backlog fetches, updated status/doctor wording to `strategy=paginated`, and aligned docs that previously described first-page-only selection. Focused tests and `npm run build` now pass after installing the local dev dependencies that were missing from this worktree.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: runnable selection was still limited by treating `candidateDiscoveryFetchWindow` as a total cap rather than a page size, so a paginated client fetch should expose runnable issues beyond the first 100 matches without changing readiness semantics.
- What changed: added focused GitHub client regressions for a 101-issue backlog and a small-backlog no-regression case, changed candidate discovery to page through the matching open backlog via `gh api`, kept deterministic created-at ordering with number tiebreaks, updated status/doctor summaries to `candidate_discovery fetch_window=<n> strategy=paginated`, and rewrote docs/tests that still claimed first-page-only discovery.
- Current blocker: none
- Next exact step: review the diff, commit the paginated discovery change on `codex/issue-778`, and open or update the draft PR with the verified checkpoint.
- Verification gap: none for the requested local scope. `npm run build` initially failed because this worktree had no `node_modules` and `tsc` was missing; after `npm install`, the targeted tests and build both passed. `.codex-supervisor/replay/` remains untracked and untouched.
- Files touched: `.codex-supervisor/issue-journal.md`, `docs/getting-started.ja.md`, `docs/getting-started.md`, `docs/issue-metadata.md`, `src/config.test.ts`, `src/doctor.test.ts`, `src/getting-started-docs.test.ts`, `src/github/github.test.ts`, `src/github/github.ts`, `src/supervisor/supervisor-diagnostics-status-selection.test.ts`, `src/supervisor/supervisor-selection-readiness-summary.ts`
- Rollback concern: reverting the paginated fetch would reintroduce the first-100 blind spot and make `status`/`doctor` overstate coverage relative to actual runnable selection behavior.
- Last focused command: `npm run build`
- Last focused failure: `npm run build` failed with `sh: 1: tsc: not found` until local dev dependencies were installed with `npm install`
- Last focused commands:
```bash
npx tsx --test src/github/github.test.ts
npx tsx --test src/run-once-issue-selection.test.ts src/supervisor/supervisor-selection-readiness-summary.test.ts src/supervisor/supervisor-diagnostics-explain.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts src/doctor.test.ts src/getting-started-docs.test.ts src/config.test.ts
npm install
npm run build
```
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
