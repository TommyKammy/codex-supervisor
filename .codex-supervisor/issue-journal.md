# Issue #777: Candidate discovery config: add an explicit fetch-window surface for scheduler candidate discovery

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/777
- Branch: codex/issue-777
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 009991c69f60b5d9237bb1d9745047ef76298c4b
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-21T13:07:52.420Z

## Latest Codex Summary
- Added an explicit `candidateDiscoveryFetchWindow` config surface with safe fallback-to-100 behavior, moved the effective candidate discovery behavior into always-visible `status`/`doctor` output, and kept the existing truncation warning tied to observed diagnostics.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: candidate discovery needs an explicit fetch-window config plus an always-visible diagnostics line so operators can see the effective first-page-only behavior even when truncation is not currently observed.
- What changed: added `candidateDiscoveryFetchWindow` config parsing with conservative integer validation and default fallback to `100`; switched GitHub candidate listing/probing to honor that configured window; surfaced `candidate_discovery fetch_window=<n> strategy=first_page_only` in `status` and `doctor`; preserved the existing truncation warning semantics; added focused tests for config loading, doctor visibility, and status visibility.
- Current blocker: none
- Next exact step: commit the local checkpoint on `codex/issue-777`, then push/open or update the draft PR for review.
- Verification gap: `npm run build` initially failed because local dev dependencies were missing and `tsc` was not on PATH; after `npm install`, the targeted suite and build both passed. `.codex-supervisor/replay/` remains untracked and untouched.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/config.test.ts`, `src/core/config.ts`, `src/core/types.ts`, `src/doctor.test.ts`, `src/doctor.ts`, `src/github/github-pull-request-hydrator.test.ts`, `src/github/github.test.ts`, `src/github/github.ts`, `src/pull-request-state-test-helpers.ts`, `src/review-handling.test.ts`, `src/run-once-issue-preparation.test.ts`, `src/run-once-issue-selection.test.ts`, `src/supervisor/replay-corpus-config.ts`, `src/supervisor/supervisor-diagnostics-status-selection.test.ts`, `src/supervisor/supervisor-selection-readiness-summary.ts`, `src/supervisor/supervisor-status-report.ts`, `src/supervisor/supervisor-test-helpers.ts`, `src/supervisor/supervisor.ts`, `src/turn-execution-test-helpers.ts`, `src/codex/codex-policy.test.ts`, `src/codex/codex-runner.test.ts`
- Rollback concern: removing the explicit fetch-window config or the new top-level diagnostics line would return candidate discovery behavior to an implicit hard-coded detail and hide the effective first-page-only scope from operators.
- Last focused command: `npx tsx --test src/config.test.ts src/doctor.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts`
- Last focused failure: `none`
- Last focused commands:
```bash
npx tsx --test src/config.test.ts src/doctor.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts
npm install
npm run build
```
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
