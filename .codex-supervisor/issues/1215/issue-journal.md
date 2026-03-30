# Issue #1215: [codex] Reproduce stale failed tracked PR recovery at run-once orchestration level

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1215
- Branch: codex/issue-1215
- Workspace: .
- Journal: .codex-supervisor/issues/1215/issue-journal.md
- Current phase: reproducing
- Attempt count: 2 (implementation=2, repair=0)
- Last head SHA: db4002b0b4359d161e425a95616a296183efa401
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-30T22:16:08.847Z

## Latest Codex Summary
Kept the committed run-once stale-failed tracked-PR reproducer from `db4002b` and fixed the remaining local verification failure in [supervisor-execution-orchestration.test.ts](src/supervisor/supervisor-execution-orchestration.test.ts) by updating the local-CI blocked-message expectation to include the current remediation-target suffix emitted by the runtime.

After restoring local dependencies with `npm ci`, the full orchestration suite and `npm run build` both pass in this worktree.

Summary: Preserved the stale failed tracked-PR run-once reproducer and repaired the unrelated orchestration assertion so the requested verification passes locally.
State hint: draft_pr
Blocked reason: none
Tests: `npx tsx --test src/supervisor/supervisor-execution-orchestration.test.ts`; `npm ci`; `npm run build`
Next action: Commit the verification-fix follow-up, push `codex/issue-1215`, and open a draft PR for review.
Failure signature: none

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: The reproduction requirement is now satisfied by the run-once same-head stale-failed tracked-PR test; the only remaining work on this branch was to bring local verification back to green.
- What changed: Left the `db4002b` reproduction test in place and updated the older local-CI blocked-message assertion so it matches the runtime remediation-target wording.
- Current blocker: None.
- Next exact step: Commit the assertion fix and journal update, then push and open the draft PR.
- Verification gap: None in the requested checks after running `npm ci`.
- Files touched: `src/supervisor/supervisor-execution-orchestration.test.ts`; `.codex-supervisor/issues/1215/issue-journal.md`
- Rollback concern: Low; follow-up only updates one stale expectation and journal state.
- Last focused command: `npm run build`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
