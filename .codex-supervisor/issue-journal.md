# Issue #710: Safer mode: add a configurable supervisor execution mode without bypassed approvals/sandbox

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/710
- Branch: codex/issue-710
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: f62f64bb8c00ab694f65cccd7d6dbc6a7192a14d
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-21T05:40:16Z

## Latest Codex Summary
- Added configurable execution-safety plumbing to Codex and local-review command construction so `operator_gated` omits bypass flags while explicit `unsandboxed_autonomous` behavior remains unchanged.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: `executionSafetyMode` was already configurable in loaded config and diagnostics, but the actual Codex execution paths still hard-coded `--dangerously-bypass-approvals-and-sandbox`, so focused runner tests should reproduce the gap before wiring the mode into command assembly.
- What changed: added focused runner tests proving `operator_gated` must omit bypass flags for both `runCodexTurn()` and `runCodexReviewTurn()`. Added shared `buildCodexExecutionSafetyArgs()` in `src/codex/codex-policy.ts` and used it in the normal Codex runner and local-review runner so only explicit `unsandboxed_autonomous` includes the bypass flag.
- Current blocker: none
- Next exact step: commit this safer-mode checkpoint and open or update a draft PR for branch `codex/issue-710`.
- Verification gap: none for the requested scope; `npx tsx --test src/codex/codex-runner.test.ts src/local-review/runner.test.ts src/config.test.ts` and `npm run build` pass locally after installing dev dependencies in this worktree.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/codex/codex-policy.ts`, `src/codex/codex-runner.test.ts`, `src/codex/codex-runner.ts`, `src/local-review/runner.test.ts`, `src/local-review/runner.ts`
- Rollback concern: removing the shared execution-safety arg helper or its runner call sites would silently restore forced bypassed approvals/sandbox even when the safer `operator_gated` mode is selected.
- Last focused command: `npx tsx --test src/codex/codex-runner.test.ts src/local-review/runner.test.ts src/config.test.ts && npm run build`
- Last focused failure: before the fix, the new operator-gated runner tests failed because both execution paths still appended `--dangerously-bypass-approvals-and-sandbox`.
- Last focused commands:
```bash
npx tsx --test src/codex/codex-runner.test.ts src/local-review/runner.test.ts
npx tsx --test src/codex/codex-runner.test.ts src/local-review/runner.test.ts src/config.test.ts
npm run build
npm install
git status --short
git diff -- src/codex/codex-policy.ts src/codex/codex-runner.ts src/codex/codex-runner.test.ts src/local-review/runner.ts src/local-review/runner.test.ts .codex-supervisor/issue-journal.md
date -u +"%Y-%m-%dT%H:%M:%SZ"
```
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
