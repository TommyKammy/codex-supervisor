# Issue #464: Test refactor: finish splitting supervisor.test.ts by execution and PR lifecycle boundaries

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/464
- Branch: codex/issue-464
- Workspace: /home/tommy/Dev/codex-supervisor-self-worktrees/issue-464
- Journal: /home/tommy/Dev/codex-supervisor-self-worktrees/issue-464/.codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 23c2337fa46bf8e4d4e95751c70d7cfbd96eb9ca
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-17T18:57:00+09:00

## Latest Codex Summary
- Extracted the remaining execution-path, PR lifecycle, and injected agent-runner coverage from `src/supervisor/supervisor.test.ts` into focused suites, leaving only a minimal facade export smoke test behind.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the remaining run-once execution, PR lifecycle, and agent-runner wiring coverage can live in dedicated suites without changing supervisor semantics, leaving `supervisor.test.ts` as a thin facade.
- What changed: Added `src/supervisor/supervisor-execution.test.ts`, `src/supervisor/supervisor-pr-lifecycle.test.ts`, and `src/supervisor/supervisor-agent-runner.test.ts`; moved the remaining execution-path, PR transition/review-blocker, and injected runner coverage out of `src/supervisor/supervisor.test.ts`; reduced `src/supervisor/supervisor.test.ts` to a single export smoke test.
- Current blocker: none
- Next exact step: Review the final diff and commit the focused suite split on `codex/issue-464`.
- Verification gap: none; the focused execution, PR lifecycle, and agent-runner suites plus `npm run build` pass locally after reinstalling dependencies.
- Files touched: src/supervisor/supervisor.test.ts; src/supervisor/supervisor-execution.test.ts; src/supervisor/supervisor-pr-lifecycle.test.ts; src/supervisor/supervisor-agent-runner.test.ts; .codex-supervisor/issue-journal.md
- Rollback concern: keep the new suites aligned to supervisor module boundaries; if future cases start mixing execution and lifecycle concerns back together, the split will regress into the same monolith under different filenames.
- Last focused command: `npm run build`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
- Reproducing signature before the fix: `src/supervisor/supervisor.test.ts` still held 2671 lines of execution-path, PR lifecycle, and agent-runner coverage after the diagnostics/recovery split.
- Focused extraction result: `src/supervisor/supervisor.test.ts` is now 7 lines; extracted suites are 1671 lines (`supervisor-execution.test.ts`), 915 lines (`supervisor-pr-lifecycle.test.ts`), and 97 lines (`supervisor-agent-runner.test.ts`).
- Focused failure during extraction: the first PR lifecycle split used a synchronous `withStubbedDateNow`, which restored `Date.now` before async `runOnce` calls completed and left Copilot-wait tests in `stabilizing`; converting the helper to `async` fixed the focused failures.
- Verification commands: `npx tsx --test src/supervisor/supervisor-execution.test.ts`; `npx tsx --test src/supervisor/supervisor-pr-lifecycle.test.ts`; `npx tsx --test src/supervisor/supervisor-agent-runner.test.ts src/supervisor/supervisor.test.ts`; `npx tsx --test src/supervisor/supervisor-execution.test.ts src/supervisor/supervisor-pr-lifecycle.test.ts src/supervisor/supervisor-agent-runner.test.ts src/supervisor/supervisor.test.ts`; `npm ci`; `npm run build`.
- Local failure resolved: `npm run build` initially failed with `sh: 1: tsc: not found` because `node_modules` was absent in this worktree; `npm ci` restored the local toolchain for the acceptance build.
