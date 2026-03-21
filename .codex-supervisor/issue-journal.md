# Issue #776: Candidate discovery visibility: warn when selection may be truncated by the first-page fetch window

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/776
- Branch: codex/issue-776
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 5b050d39a410f603919f10ebc553939530601422
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-21T12:18:04Z

## Latest Codex Summary
- Added a focused candidate-discovery truncation warning path. `status` now prepends a structured readiness warning when more than 100 matching open issues are detected, and `doctor` renders a matching operator warning without changing selection behavior.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: `status` and `doctor` need an explicit operator-facing warning when the first-page candidate fetch window can hide additional matching open issues, so operators can distinguish “no runnable issue” from incomplete discovery.
- What changed: added focused failing tests for `status` and `doctor`, introduced a shared candidate discovery diagnostic type/formatting path, added a GitHub probe that requests one extra matching candidate (`--limit 101`) without changing actual selection (`--limit 100`), and surfaced the warning in readiness and doctor output.
- Current blocker: none
- Next exact step: commit the status/doctor warning checkpoint and update the draft PR branch if needed.
- Verification gap: none in the targeted suites or build; `npm ci` was required in this worktree because `node_modules/` was absent. `.codex-supervisor/replay/` remains untracked and untouched.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/core/types.ts`, `src/doctor.test.ts`, `src/doctor.ts`, `src/github/github.ts`, `src/supervisor/supervisor-diagnostics-status-selection.test.ts`, `src/supervisor/supervisor-selection-readiness-summary.ts`
- Rollback concern: removing the probe or warning would re-hide first-page truncation and make operators misread incomplete candidate discovery as definitive scheduler state.
- Last focused command: `npm run build`
- Last focused failure: `candidate-discovery-warning-missing`
- Last focused commands:
```bash
npx tsx --test src/doctor.test.ts
npx tsx --test src/supervisor/supervisor-diagnostics-status-selection.test.ts
npx tsx --test src/doctor.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts
npm ci
npm run build
```
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
