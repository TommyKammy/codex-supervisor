# Issue #726: Orphan cleanup visibility: surface prune candidates and eligibility reasons before deletion

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/726
- Branch: codex/issue-726
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: fc825ebb4fed41272ba17e3ed8ea591b9f74c788
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-20T20:31:48.433Z

## Latest Codex Summary
- Added orphan prune candidate visibility to `doctor` by classifying untracked `issue-*` worktrees as `eligible`, `locked`, `recent`, or `unsafe_target` without changing cleanup behavior.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: `#726` needs a narrow runtime visibility change, not a pruning-policy change: expose orphaned worktree prune candidates through diagnostics with deterministic eligibility reasons, while leaving actual cleanup behavior untouched.
- What changed: added focused `doctor` regression tests for orphan prune candidate reporting, extracted `inspectOrphanedWorkspacePruneCandidates()` in `src/recovery-reconciliation.ts`, and wired `src/doctor.ts` to report orphan candidates in the existing `worktrees` diagnostic summary/details.
- Current blocker: none
- Next exact step: review the diff and open or update the draft PR for issue `#726`.
- Verification gap: full repo test suite was not rerun; verification this turn is the focused orphan-cleanup/doctor tests plus `npm run build`.
- Files touched: `src/doctor.test.ts`, `src/doctor.ts`, `src/recovery-reconciliation.ts`, `.codex-supervisor/issue-journal.md`
- Rollback concern: reverting these changes would remove the only operator-visible, testable classification of orphan prune candidates before cleanup policy changes land.
- Last focused commands:
```bash
sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-726/AGENTS.generated.md
sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-726/context-index.md
sed -n '1,260p' .codex-supervisor/issue-journal.md
git status --short --branch
rg -n "cleanupExpiredDoneWorkspaces|orphaned worktree|orphan" src/*.ts src/supervisor/*.ts
sed -n '1,420p' src/recovery-reconciliation.ts
sed -n '1,260p' src/doctor.ts
sed -n '1,260p' src/doctor.test.ts
sed -n '400,620p' src/supervisor/supervisor-execution-cleanup.test.ts
npx tsx --test src/doctor.test.ts --test-name-pattern="orphan prune candidates|unsafe orphan prune targets"
npx tsx --test src/run-once-cycle-prelude.test.ts src/supervisor/supervisor-execution-cleanup.test.ts src/doctor.test.ts
npm install
npm run build
date -u +"%Y-%m-%dT%H:%M:%SZ"
```
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
