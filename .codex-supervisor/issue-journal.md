# Issue #937: Stale already-landed convergence misclassifies replay artifacts and blocks issue #924

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/937
- Branch: codex/issue-937
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: waiting_ci
- Attempt count: 2 (implementation=1, repair=1)
- Last head SHA: 2b87ac4ed5c1bb0994f254849c407078dc045dc0
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-24T13:23:30Z

## Latest Codex Summary
Merged `origin/main` into `codex/issue-937` as `6856871`, refreshed the issue journal in `2b87ac4`, and pushed the branch back to `origin/codex/issue-937`. The stale no-PR replay-artifact fix remained intact after the base integration, including the newer `main`-branch reconciliation and post-merge-audit plumbing.

Focused verification still passes on the merged tree: `npx tsx --test src/supervisor/supervisor-stale-no-pr-branch-state.test.ts src/supervisor/supervisor-recovery-reconciliation.test.ts src/supervisor/supervisor-execution-orchestration.test.ts` and `npm run build`. Draft PR [#945](https://github.com/TommyKammy/codex-supervisor/pull/945) now points at `2b87ac4` and GitHub reports `mergeStateStatus=UNSTABLE` only because CI is currently in progress (`build (ubuntu-latest)` and `build (macos-latest)` started at `2026-03-24T13:23:08Z`). The only remaining local artifact is the intentionally untracked `.codex-supervisor/replay/` directory.

Summary: Integrated `origin/main`, preserved the replay-artifact already-landed convergence fix, resolved the tracked journal conflict conservatively, and revalidated the targeted supervisor tests plus build.
State hint: waiting_ci
Blocked reason: none
Tests: `npx tsx --test src/supervisor/supervisor-stale-no-pr-branch-state.test.ts src/supervisor/supervisor-recovery-reconciliation.test.ts src/supervisor/supervisor-execution-orchestration.test.ts`; `npm run build`
Next action: Monitor draft PR #945 until CI completes, then recheck mergeability once GitHub stops reporting `UNSTABLE`.
Failure signature: none

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the replay-artifact fix is complete, and the branch is now only waiting for GitHub to finish reevaluating PR #945 on the refreshed merge base.
- What changed: merged `origin/main` into `codex/issue-937` as `6856871`; reviewed the merged [supervisor.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-937/src/supervisor/supervisor.ts), [recovery-reconciliation.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-937/src/recovery-reconciliation.ts), and [supervisor-recovery-reconciliation.test.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-937/src/supervisor/supervisor-recovery-reconciliation.test.ts) changes to confirm the replay-artifact classifier and already-satisfied convergence logic still hold after the new `main`-branch signatures and post-merge-audit sync hooks landed; resolved the tracked journal conflict by keeping the issue-937 journal content and letting Git reapply the local journal edits after the merge commit; committed the refreshed journal as `2b87ac4` and pushed `codex/issue-937` to update PR #945.
- Current blocker: none.
- Next exact step: monitor draft PR #945 until the in-progress CI jobs finish, then recheck mergeability once GitHub stops reporting `UNSTABLE`.
- Verification gap: none for the targeted stale no-PR path after the base merge; focused stale branch-state, reconciliation, and orchestration tests plus `npm run build` all pass on `6856871`, and the pushed head is `2b87ac4`.
- Files touched: merge commit `6856871`, journal follow-up `2b87ac4`, and `.codex-supervisor/issue-journal.md`; issue-specific logic remains in `src/recovery-reconciliation.ts`, `src/supervisor/supervisor.ts`, `src/supervisor/supervisor-stale-no-pr-branch-state.test.ts`, `src/supervisor/supervisor-recovery-reconciliation.test.ts`, `src/supervisor/supervisor-execution-orchestration.test.ts`, and `src/supervisor/supervisor-test-helpers.ts`.
- Rollback concern: low; reverting the merge would restore the dirty PR state, and reverting the issue-specific commits would restore the stale replay-artifact misclassification and the incorrect manual-review convergence path for already-landed no-PR recovery.
- Last focused command: `gh pr view 945 --json url,isDraft,mergeStateStatus,reviewDecision,headRefOid,statusCheckRollup`
- Last focused failure: `git merge --autostash origin/main` stopped on the tracked `.codex-supervisor/issue-journal.md` conflict because `origin/main` carried a different issue journal; resolved by keeping the issue-937 journal content and letting Git reapply the local journal edits after the merge commit.
- Draft PR: https://github.com/TommyKammy/codex-supervisor/pull/945
- Last focused commands:
```bash
sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-937/AGENTS.generated.md
sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-937/context-index.md
sed -n '1,260p' .codex-supervisor/issue-journal.md
git status --short --branch
git fetch origin
git merge --autostash origin/main
git diff --cached --unified=40 -- src/recovery-reconciliation.ts src/supervisor/supervisor.ts src/supervisor/supervisor-recovery-reconciliation.test.ts src/supervisor/supervisor-stale-no-pr-branch-state.test.ts src/supervisor/supervisor-execution-orchestration.test.ts src/supervisor/supervisor-test-helpers.ts
git checkout --ours .codex-supervisor/issue-journal.md
npx tsx --test src/supervisor/supervisor-stale-no-pr-branch-state.test.ts src/supervisor/supervisor-recovery-reconciliation.test.ts src/supervisor/supervisor-execution-orchestration.test.ts
npm run build
git commit -m "Merge origin/main into codex/issue-937"
git commit -m "Update issue #937 journal after merge resolution"
git push origin codex/issue-937
gh pr view 945 --json url,isDraft,mergeStateStatus,reviewDecision,headRefOid,statusCheckRollup
```
### Scratchpad
- Leave `.codex-supervisor/replay/` untracked; it is local replay output, not part of the fix.
