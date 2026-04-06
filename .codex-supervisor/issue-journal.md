# Issue #1306: [codex] Clarify workspacePreparationCommand runtime failures and suggest repo-native preparation commands

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1306
- Branch: codex/issue-1306
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: e17a0d3576d6362039001cdd8cd3fdd5f2e45d22
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-04-05T23:51:39.772Z

## Latest Codex Summary
- Reproduced the workspace-preparation runtime gap with a focused `runWorkspacePreparationGate` test, then implemented a dedicated `worktree_helper_missing` failure path that explains missing repo-relative helpers in issue worktrees, highlights likely untracked/host-local primary-checkout causes, and suggests repo-native preparation commands when the repo exposes an obvious candidate such as `npm ci`.
- Extended setup readiness messaging to surface repo-native `workspacePreparationCommand` suggestions from tracked lockfiles, and threaded the new workspace-preparation diagnostics through tracked-PR blocker comments and publication-gate typing.
- Verified with `npx tsx --test src/local-ci.test.ts src/setup-readiness.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts` and `npm run build`.
- Committed as `963545d` (`Clarify workspace preparation helper failures`), pushed `codex/issue-1306`, and opened draft PR #1310.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: `workspacePreparationCommand` runtime failures were too generic because missing repo-relative helpers in issue worktrees were being classified like ordinary command failures, and readiness had no repo-native preparation recommendation path.
- What changed: Added repo-native workspace-preparation candidate detection from lockfiles, specialized runtime diagnosis for missing repo-relative helpers in issue worktrees, updated workspace-preparation summaries/comments to surface likely untracked primary-checkout causes plus recommended repo-native commands, and added focused regression tests.
- Current blocker: none
- Next exact step: Wait for PR feedback/CI on draft PR #1310 or continue with any follow-up review comments.
- Verification gap: none for the requested local suite; broader full-test coverage was not run beyond the issue-scoped commands.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/core/config.ts`, `src/core/types.ts`, `src/doctor.test.ts`, `src/local-ci.ts`, `src/local-ci.test.ts`, `src/post-turn-pull-request.ts`, `src/setup-readiness.ts`, `src/setup-readiness.test.ts`, `src/turn-execution-publication-gate.ts`
- Rollback concern: the new `worktree_helper_missing` failure class now flows through workspace-preparation signatures and tracked-PR blocker remediation targeting, so any future rollback should revert the runtime classification and the added contract-summary field together.
- Last focused command: `npm run build`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
