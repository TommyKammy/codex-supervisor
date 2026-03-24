# Issue #951: Local CI path enforcement: include `verify:paths` in the repo-owned pre-PR verification contract

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/951
- Branch: codex/issue-951
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: stabilizing
- Attempt count: 2 (implementation=2, repair=0)
- Last head SHA: bdb634c399daa0d6b914cd6bbd8b4b60dd123b33
- Blocked reason: none
- Last failure signature: stale-stabilizing-no-pr-recovery-loop
- Repeated failure signature count: 0
- Updated at: 2026-03-24T20:54:44.116Z

## Latest Codex Summary
Added a repo-owned pre-PR contract in `package.json` as `verify:pre-pr`, wired to run `verify:paths` before `build` and `test`. I locked that down with `src/pre-pr-verification-contract.test.ts`, then refreshed stale clean-tree assertions in `src/family-directory-layout.test.ts` and `src/turn-execution-orchestration.test.ts` so the expanded contract passes end to end. A fresh rerun then exposed workstation-local absolute links in `.codex-supervisor/issue-journal.md`, so I sanitized the durable handoff text and re-ran the full contract successfully.

Committed on `codex/issue-951` as `bdb634c` (`Add verify:paths to pre-PR contract`). Local untracked supervisor replay artifacts remain in `.codex-supervisor/pre-merge/` and `.codex-supervisor/replay/`.

Summary: Added `verify:pre-pr` with `verify:paths` first, refreshed stale tests, sanitized the durable journal handoff, and verified the full local contract passes.
State hint: stabilizing
Blocked reason: none
Tests: `npx tsx --test src/pre-pr-verification-contract.test.ts src/workstation-local-path-detector.test.ts`; `npx tsx --test src/family-directory-layout.test.ts`; `npx tsx --test src/turn-execution-orchestration.test.ts`; `npm run verify:pre-pr` (failed once on `.codex-supervisor/issue-journal.md` absolute paths, then passed after sanitizing them)
Next action: Commit the sanitized journal handoff, push `codex/issue-951`, and open the draft PR
Failure signature: stale-stabilizing-no-pr-recovery-loop

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: issue #951 is satisfied by exposing a canonical repo-owned `verify:pre-pr` script that starts with `verify:paths`, then preserving the clean-tree pass path by fixing stale test expectations uncovered by the broadened contract.
- What changed: added `verify:pre-pr` to `package.json`, added `src/pre-pr-verification-contract.test.ts` to lock the contract shape, updated `src/family-directory-layout.test.ts` to the current checked-in source layout, refreshed the stale verification-policy assertion in `src/turn-execution-orchestration.test.ts`, and sanitized `.codex-supervisor/issue-journal.md` so the durable handoff no longer trips `verify:paths`.
- Current blocker: none.
- Next exact step: commit the sanitized journal handoff, push `codex/issue-951`, and open the draft PR.
- Verification gap: none; `npm run verify:pre-pr` passed after removing the journal's workstation-local absolute paths.
- Files touched: `package.json`, `src/pre-pr-verification-contract.test.ts`, `src/family-directory-layout.test.ts`, `src/turn-execution-orchestration.test.ts`, `.codex-supervisor/issue-journal.md`.
- Rollback concern: low; the functional change is limited to the repo-owned pre-PR contract, and the other edits only refresh stale test expectations so the clean tree passes.
- Last focused command: `npm run verify:pre-pr`
### Scratchpad
- Leave `.codex-supervisor/replay/` untracked; it is local replay output, not part of the fix.
