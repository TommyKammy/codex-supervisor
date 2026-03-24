# Issue #946: Stale no-PR branch-state bug: preserve whitespace in base-diff paths before replay-artifact filtering

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/946
- Branch: codex/issue-946
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: stabilizing
- Attempt count: 4 (implementation=4, repair=0)
- Last head SHA: d88c032746f0fd1dc3fba16800023ed1fc9470e2
- Blocked reason: none
- Last failure signature: stale-stabilizing-no-pr-recovery-loop
- Repeated failure signature count: 0
- Updated at: 2026-03-24T16:02:17.000Z

## Latest Codex Summary
Fixed the stale no-PR branch-state gap in [src/supervisor/supervisor.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-946/src/supervisor/supervisor.ts) by preserving literal `git diff --name-only` path text before replay-artifact filtering. I also added tracked base-diff regressions in [src/supervisor/supervisor-stale-no-pr-branch-state.test.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-946/src/supervisor/supervisor-stale-no-pr-branch-state.test.ts) to prove that leading-whitespace replay-like paths stay meaningful while exact supervisor-owned replay artifact paths remain ignored.

The requested focused tests and `npm run build` both pass after the change. The worktree still has expected untracked local supervisor artifacts under `.codex-supervisor/pre-merge/` and `.codex-supervisor/replay/`.

Summary: Removed base-diff path trimming before replay-artifact filtering and added tracked whitespace-path regressions for stale no-PR classification
State hint: stabilizing
Blocked reason: none
Tests: `npx tsx --test src/supervisor/supervisor-stale-no-pr-branch-state.test.ts src/supervisor/supervisor-recovery-reconciliation.test.ts src/supervisor/supervisor-execution-orchestration.test.ts`; `npm run build`
Next action: Commit this checkpoint, push `codex/issue-946`, and open a draft PR for review
Failure signature: none

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the real bug was still present on `d88c032`; `classifyStaleStabilizingNoPrBranchState()` trimmed each `git diff --name-only` line before calling `isIgnoredSupervisorArtifactPath()`, so a tracked path like ` .codex-supervisor/replay/decision-cycle-snapshot.json` could be collapsed into a supervisor-owned replay artifact and misclassified as already satisfied on `main`.
- What changed: removed the `.trim()` normalization from the base-diff path pipeline in `src/supervisor/supervisor.ts` so replay-artifact filtering compares the literal diff text. Added two focused regressions in `src/supervisor/supervisor-stale-no-pr-branch-state.test.ts`: one that keeps exact tracked replay artifact paths ignored in the base diff, and one that proves a tracked leading-space replay-like path remains meaningful and keeps the branch recoverable. Reran the requested focused tests plus `npm run build`, and refreshed this journal entry with the current verification timestamp.
- Current blocker: none.
- Next exact step: create a checkpoint commit for the implementation and journal updates, then push `codex/issue-946` and open a draft PR since this branch now contains a coherent reviewable fix.
- Verification gap: none; the requested focused tests and `npm run build` both pass in this workspace as of 2026-03-24T16:02:17Z.
- Files touched: [.codex-supervisor/issue-journal.md](.codex-supervisor/issue-journal.md), [src/supervisor/supervisor.ts](src/supervisor/supervisor.ts), and [src/supervisor/supervisor-stale-no-pr-branch-state.test.ts](src/supervisor/supervisor-stale-no-pr-branch-state.test.ts).
- Rollback concern: low; reverting this patch would reintroduce the base-diff false-ignore bug for whitespace-prefixed replay-like tracked paths.
- Last focused command: `date -Iseconds -u`
- Last focused failure: none.
- Draft PR: none.
- Last focused commands:
```bash
sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-946/AGENTS.generated.md
sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-946/context-index.md
sed -n '1,320p' .codex-supervisor/issue-journal.md
git status --short
git rev-parse HEAD
git rev-list --left-right --count origin/main...HEAD
gh pr list --head codex/issue-946 --state all --json number,state,isDraft,title,headRefName,baseRefName,url
rg -n "replay artifact|base-diff|trim\\(|supervisor-owned" src/supervisor
git diff -- .codex-supervisor/issue-journal.md
sed -n '1,260p' src/supervisor/supervisor-stale-no-pr-branch-state.test.ts
sed -n '1,260p' src/supervisor/supervisor-recovery-reconciliation.test.ts
sed -n '1,260p' src/supervisor/supervisor-execution-orchestration.test.ts
sed -n '430,520p' src/supervisor/supervisor.ts
git diff -- src/supervisor/supervisor.ts src/supervisor/supervisor-stale-no-pr-branch-state.test.ts
npx tsx --test src/supervisor/supervisor-stale-no-pr-branch-state.test.ts
npx tsx --test src/supervisor/supervisor-stale-no-pr-branch-state.test.ts src/supervisor/supervisor-recovery-reconciliation.test.ts src/supervisor/supervisor-execution-orchestration.test.ts
npm run build
date -Iseconds -u
```
### Scratchpad
- Leave `.codex-supervisor/replay/` untracked; it is local replay output, not part of the fix.
