# Issue #913: Local CI gate follow-up: keep blocked verification flows isolated from execution-metrics failures

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/913
- Branch: codex/issue-913
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 6fc3022fef5ffc8f76e5f0a0d088092c426c1b75
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-24T00:00:44.588Z

## Latest Codex Summary
- Added a safe execution-metrics run-summary wrapper so local-CI blocked-before-PR flows stay blocked even when observational metrics validation or writes fail.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: execution-metrics persistence must remain observational; local-CI failures before PR creation should stay normal blocked verification outcomes even when run-summary validation or writes fail.
- What changed: added `syncExecutionMetricsRunSummarySafely()` in `src/supervisor/execution-metrics-run-summary.ts` to centralize the warning-and-continue behavior for terminal run-summary persistence; switched the direct terminal-state persistence in `src/run-once-issue-preparation.ts` and `src/run-once-turn-execution.ts` to the safe wrapper; refactored `src/turn-execution-failure-helpers.ts` and `src/supervisor/supervisor-failure-helpers.ts` to use the shared helper instead of duplicating try/catch blocks; added a focused regression in `src/run-once-turn-execution.test.ts` that forces an execution-metrics validation failure during the local-CI blocked-before-PR path and asserts the flow still returns the blocked result.
- Current blocker: none
- Next exact step: stage the issue-913 changes, create a checkpoint commit on `codex/issue-913`, and open or update a draft PR if one does not already exist.
- Verification gap: no known gap in the targeted blocked-before-PR local-CI flow; broader full-suite coverage was not rerun beyond the focused execution, preparation, local-CI, and recovery-helper tests plus `npm run build`.
- Files touched: `src/supervisor/execution-metrics-run-summary.ts`, `src/run-once-issue-preparation.ts`, `src/run-once-turn-execution.ts`, `src/turn-execution-failure-helpers.ts`, `src/supervisor/supervisor-failure-helpers.ts`, `src/run-once-turn-execution.test.ts`, `.codex-supervisor/issue-journal.md`
- Rollback concern: low; the change only isolates observational execution-metrics failures from terminal execution-state transitions and does not change the local-CI contract itself.
- Last focused command: `npx tsx --test src/run-once-turn-execution.test.ts src/run-once-issue-preparation.test.ts src/local-ci.test.ts && npx tsx --test src/turn-execution-failure-helpers.test.ts src/supervisor/supervisor-recovery-failure-flows.test.ts && npm run build`
- Last focused failure: `npm run build` initially failed because `node_modules` was absent and `tsc` was not installed in this worktree; `npm ci` restored the local toolchain and the rerun passed.
- Last focused commands:
```bash
sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-913/AGENTS.generated.md
sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-913/context-index.md
sed -n '1,260p' .codex-supervisor/issue-journal.md
git status --short
git branch --show-current
rg -n "local ci|local-ci|execution-metrics|run-summary|blocked verification|unexpected-failure|unexpected failure|verification blocked" src
sed -n '400,560p' src/run-once-turn-execution.test.ts
sed -n '1,260p' src/run-once-issue-preparation.test.ts
sed -n '1,260p' src/local-ci.test.ts
sed -n '1,260p' src/run-once-issue-preparation.ts
sed -n '1,260p' src/run-once-turn-execution.ts
sed -n '1,260p' src/supervisor/execution-metrics-run-summary.ts
sed -n '1,280p' src/supervisor/execution-metrics-lifecycle.ts
sed -n '320,520p' src/supervisor/execution-metrics-run-summary.test.ts
sed -n '1,260p' src/supervisor/execution-metrics-schema.test.ts
sed -n '1,240p' src/turn-execution-failure-helpers.test.ts
apply_patch
apply_patch
npx tsx --test src/run-once-turn-execution.test.ts
npx tsx --test src/run-once-turn-execution.test.ts src/run-once-issue-preparation.test.ts src/local-ci.test.ts
npx tsx --test src/turn-execution-failure-helpers.test.ts src/supervisor/supervisor-recovery-failure-flows.test.ts
npm run build
test -d node_modules && echo present || echo missing
sed -n '1,220p' package.json
ls | rg 'package-lock.json|pnpm-lock.yaml|yarn.lock'
npm ci
npm run build
```
### Scratchpad
- Leave `.codex-supervisor/replay/` untracked; it is local replay output, not part of the fix.
