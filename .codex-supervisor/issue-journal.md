# Issue #937: Stale already-landed convergence misclassifies replay artifacts and blocks issue #924

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/937
- Branch: codex/issue-937
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: resolving_conflict
- Attempt count: 2 (implementation=1, repair=1)
- Last head SHA: 6856871a0d1fc6a2ff0ae2ed22da33b64131f3d2
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-24T13:20:46Z

## Latest Codex Summary
Merged `origin/main` into `codex/issue-937` as `6856871` and kept the issue-937 side of the only tracked conflict in `.codex-supervisor/issue-journal.md`. The stale no-PR replay-artifact fix remained intact after the base integration, including the newer `main`-branch reconciliation and post-merge-audit plumbing.

Focused verification still passes on the merged tree: `npx tsx --test src/supervisor/supervisor-stale-no-pr-branch-state.test.ts src/supervisor/supervisor-recovery-reconciliation.test.ts src/supervisor/supervisor-execution-orchestration.test.ts` and `npm run build`. The only remaining local artifact is the intentionally untracked `.codex-supervisor/replay/` directory.

Summary: Integrated `origin/main`, preserved the replay-artifact already-landed convergence fix, resolved the tracked journal conflict conservatively, and revalidated the targeted supervisor tests plus build.
State hint: resolving_conflict
Blocked reason: none
Tests: `npx tsx --test src/supervisor/supervisor-stale-no-pr-branch-state.test.ts src/supervisor/supervisor-recovery-reconciliation.test.ts src/supervisor/supervisor-execution-orchestration.test.ts`; `npm run build`
Next action: Push `codex/issue-937` to refresh draft PR #945, then monitor CI and mergeability on the updated base.
Failure signature: none

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the replay-artifact fix is complete, and the remaining work for issue #937 was only to integrate the latest base branch so draft PR #945 no longer reports a dirty merge state.
- What changed: merged `origin/main` into `codex/issue-937` as `6856871`; reviewed the merged [supervisor.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-937/src/supervisor/supervisor.ts), [recovery-reconciliation.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-937/src/recovery-reconciliation.ts), and [supervisor-recovery-reconciliation.test.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-937/src/supervisor/supervisor-recovery-reconciliation.test.ts) changes to confirm the replay-artifact classifier and already-satisfied convergence logic still hold after the new `main`-branch signatures and post-merge-audit sync hooks landed; resolved the tracked journal conflict by keeping the issue-937 journal content and letting Git reapply the local journal edits after the merge commit.
- Current blocker: none.
- Next exact step: push `codex/issue-937` to refresh draft PR #945, then monitor CI and mergeability on the updated base.
- Verification gap: none for the targeted stale no-PR path after the base merge; focused stale branch-state, reconciliation, and orchestration tests plus `npm run build` all pass on `6856871`.
- Files touched: merge commit `6856871` plus `.codex-supervisor/issue-journal.md`; issue-specific logic remains in `src/recovery-reconciliation.ts`, `src/supervisor/supervisor.ts`, `src/supervisor/supervisor-stale-no-pr-branch-state.test.ts`, `src/supervisor/supervisor-recovery-reconciliation.test.ts`, `src/supervisor/supervisor-execution-orchestration.test.ts`, and `src/supervisor/supervisor-test-helpers.ts`.
- Rollback concern: low; reverting the merge would restore the dirty PR state, and reverting the issue-specific commits would restore the stale replay-artifact misclassification and the incorrect manual-review convergence path for already-landed no-PR recovery.
- Last focused command: `git commit -m "Merge origin/main into codex/issue-937"`
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
```
### Scratchpad
- Leave `.codex-supervisor/replay/` untracked; it is local replay output, not part of the fix.
