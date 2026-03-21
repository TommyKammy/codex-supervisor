# Issue #777: Candidate discovery config: add an explicit fetch-window surface for scheduler candidate discovery

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/777
- Branch: codex/issue-777
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: stabilizing
- Attempt count: 2 (implementation=2, repair=0)
- Last head SHA: fc8ad7d9a3eb399cd401e43677673be8004924b0
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-21T13:24:29.323Z

## Latest Codex Summary
Implemented the explicit candidate discovery fetch-window surface and committed it as `fc8ad7d`.

The change adds `candidateDiscoveryFetchWindow` config parsing with safe fallback to `100`, switches GitHub candidate discovery to honor the configured window, and makes the effective first-page-only behavior visible in both `status` and `doctor` via a stable diagnostics line while preserving the existing truncation warning when the probe shows overflow. Focused coverage was added for config loading and diagnostics visibility. I also updated the issue journal handoff; `.codex-supervisor/replay/` is still untracked and untouched.

Tests run:
- `npx tsx --test src/config.test.ts src/doctor.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts`
- `npm install`
- `npm run build`

Summary: Added explicit candidate discovery fetch-window config, surfaced effective behavior in status/doctor, and committed the verified checkpoint as `fc8ad7d`.
State hint: draft_pr
Blocked reason: none
Tests: `npx tsx --test src/config.test.ts src/doctor.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts`; `npm run build`
Failure signature: none
Next action: push `codex/issue-777` and open or update the draft PR for review

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: candidate discovery needs an explicit fetch-window config plus an always-visible diagnostics line so operators can see the effective first-page-only behavior even when truncation is not currently observed.
- What changed: pushed `codex/issue-777` to `origin`, opened draft PR `#789` (`https://github.com/TommyKammy/codex-supervisor/pull/789`), and kept the committed checkpoint `fc8ad7d` intact. The branch now contains the explicit `candidateDiscoveryFetchWindow` config surface, GitHub candidate discovery honors that window, `status`/`doctor` show `candidate_discovery fetch_window=<n> strategy=first_page_only`, and focused tests plus build passed locally.
- Current blocker: none
- Next exact step: watch draft PR `#789` CI and review feedback, then address any failures or comments.
- Verification gap: local verification is green (`npx tsx --test src/config.test.ts src/doctor.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts`, `npm run build`), but PR `#789` currently reports `mergeStateStatus=UNSTABLE`, so remote checks still need to settle. `.codex-supervisor/replay/` remains untracked and untouched.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/config.test.ts`, `src/core/config.ts`, `src/core/types.ts`, `src/doctor.test.ts`, `src/doctor.ts`, `src/github/github-pull-request-hydrator.test.ts`, `src/github/github.test.ts`, `src/github/github.ts`, `src/pull-request-state-test-helpers.ts`, `src/review-handling.test.ts`, `src/run-once-issue-preparation.test.ts`, `src/run-once-issue-selection.test.ts`, `src/supervisor/replay-corpus-config.ts`, `src/supervisor/supervisor-diagnostics-status-selection.test.ts`, `src/supervisor/supervisor-selection-readiness-summary.ts`, `src/supervisor/supervisor-status-report.ts`, `src/supervisor/supervisor-test-helpers.ts`, `src/supervisor/supervisor.ts`, `src/turn-execution-test-helpers.ts`, `src/codex/codex-policy.test.ts`, `src/codex/codex-runner.test.ts`
- Rollback concern: removing the explicit fetch-window config or the new top-level diagnostics line would return candidate discovery behavior to an implicit hard-coded detail and hide the effective first-page-only scope from operators.
- Last focused command: `gh pr create --draft --base main --head codex/issue-777 --title "Add explicit candidate discovery fetch-window diagnostics" --body ...`
- Last focused failure: `none`
- Last focused commands:
```bash
git push -u origin codex/issue-777
gh pr create --draft --base main --head codex/issue-777 --title "Add explicit candidate discovery fetch-window diagnostics" --body ...
gh pr view 789 --json url,isDraft,mergeStateStatus,headRefName,baseRefName
```
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
