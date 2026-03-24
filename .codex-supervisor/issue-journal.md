# Issue #951: Local CI path enforcement: include `verify:paths` in the repo-owned pre-PR verification contract

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/951
- Branch: codex/issue-951
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 6117c1536c66a05b3e5dc3276688089929ead602
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-24T20:31:46.764Z

## Latest Codex Summary
- Added a repo-owned `verify:pre-pr` contract that runs `verify:paths` before `build` and `test`, added a focused package-script regression test, refreshed stale source-layout and prompt assertions so the clean-tree contract passes, and verified `npm run verify:pre-pr` end to end.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: issue #951 is satisfied by exposing a canonical repo-owned `verify:pre-pr` script that starts with `verify:paths`, then preserving the clean-tree pass path by fixing stale test expectations uncovered by the broadened contract.
- What changed: added `verify:pre-pr` to `package.json`, added `src/pre-pr-verification-contract.test.ts` to lock the contract shape, updated `src/family-directory-layout.test.ts` to the current checked-in source layout, and refreshed the stale verification-policy assertion in `src/turn-execution-orchestration.test.ts`.
- Current blocker: none.
- Next exact step: commit the local checkpoint for issue #951 and push/update the branch or draft PR as needed.
- Verification gap: none.
- Files touched: `package.json`, `src/pre-pr-verification-contract.test.ts`, `src/family-directory-layout.test.ts`, `src/turn-execution-orchestration.test.ts`, `.codex-supervisor/issue-journal.md`.
- Rollback concern: low; the functional change is limited to the repo-owned pre-PR contract, and the other edits only refresh stale test expectations so the clean tree passes.
- Last focused command: `npm run verify:pre-pr`
### Scratchpad
- Leave `.codex-supervisor/replay/` untracked; it is local replay output, not part of the fix.
