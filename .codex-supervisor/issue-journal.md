# Issue #1111: Prevent artificial PR merge conflicts from the shared committed issue journal path

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1111
- Branch: codex/issue-1111
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: stabilizing
- Attempt count: 2 (implementation=2, repair=0)
- Last head SHA: 248c45e0f67c56bd7fee1e14ede215c934f4e47c
- Blocked reason: none
- Last failure signature: stale-stabilizing-no-pr-recovery-loop
- Repeated failure signature count: 0
- Updated at: 2026-03-27T10:29:27Z

## Latest Codex Summary
Implemented the fix on `codex/issue-1111` and committed it as `248c45e` (`Prevent shared journal merge conflicts`).

The change makes the default durable journal path issue-scoped via `.codex-supervisor/issues/{issueNumber}/issue-journal.md`, threads that through preparation/selection/supervisor path synthesis, updates replay-corpus normalization, and adds a focused git-based regression proving two unrelated issue branches no longer conflict just because both persist journal state. Focused verification passed. The only remaining workspace changes are untracked supervisor artifacts under `.codex-supervisor/`.

Summary: Default issue journals are now issue-scoped, unrelated issue branches no longer conflict on one shared committed journal file, focused regression coverage passed, and checkpoint commit `248c45e` is ready.
State hint: stabilizing
Blocked reason: none
Tests: `npx tsx --test src/journal.test.ts src/run-once-issue-preparation.test.ts src/core/workspace.test.ts src/supervisor/replay-corpus-config.test.ts src/supervisor/replay-corpus-promotion.test.ts src/index.test.ts`; `npx tsx --test src/run-once-issue-selection.test.ts src/supervisor/supervisor-stale-no-pr-branch-state.test.ts src/supervisor/replay-corpus-runner.test.ts src/supervisor/supervisor-cycle-replay.test.ts`
Next action: push `codex/issue-1111` and open or update the draft PR, then decide whether to run a broader repo verification pass.
Failure signature: stale-stabilizing-no-pr-recovery-loop

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the durable handoff can stay committed, but the default journal path must be issue-scoped so unrelated branches stop competing on one tracked `.codex-supervisor/issue-journal.md` file.
- What changed: switched the default journal template to `.codex-supervisor/issues/{issueNumber}/issue-journal.md`, resolved the template wherever a journal path is synthesized, updated replay-corpus normalization to keep the issue-scoped path, and added a focused git-based regression that merges one unrelated issue branch into `main` before merging `main` into another issue branch.
- Current blocker: none locally.
- Next exact step: stage only the journal handoff update, push `codex/issue-1111` to the GitHub remote, open the draft PR against `main`, and then decide whether to widen verification beyond the focused journal-path ring.
- Verification gap: I have not run the full repository suite or an end-to-end supervisor publication flow; verification so far covers focused journal, preparation, selection, replay, supervisor stale-state, and the new merge-conflict reproduction path.
- Files touched: `src/core/journal.ts`; `src/core/config.ts`; `src/run-once-issue-preparation.ts`; `src/run-once-issue-selection.ts`; `src/supervisor/supervisor.ts`; `src/supervisor/replay-corpus-config.ts`; `src/supervisor/replay-corpus-promotion.ts`; `src/core/workspace.test.ts`; `src/journal.test.ts`; `src/run-once-issue-preparation.test.ts`; `src/supervisor/replay-corpus-config.test.ts`; `src/supervisor/replay-corpus-promotion.test.ts`; `src/index.test.ts`; `.codex-supervisor/issue-journal.md`.
- Rollback concern: low. The behavioral change is confined to default journal-path synthesis; explicit custom `issueJournalRelativePath` values still work, and the new regression proves unrelated issue branches no longer conflict only because of journal persistence.
- Last focused command: `gh repo view --json nameWithOwner,defaultBranchRef`
- What changed this turn: reread the required memory files and journal, confirmed the committed checkpoint `248c45e` still matches the issue scope, verified there is no existing PR for `codex/issue-1111`, confirmed GitHub auth and target repo metadata, and prepared a journal-only handoff update so the branch can be published cleanly.
- Exact failure reproduced this turn: with the old shared committed path, unrelated issue branches would both commit `.codex-supervisor/issue-journal.md`; after one branch merged, merging `main` into the other branch created an avoidable conflict even though the implementation files did not overlap.
- Commands run this turn: `sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self-clean/.local/memory/TommyKammy-codex-supervisor/issue-1111/AGENTS.generated.md`; `sed -n '1,260p' /home/tommy/Dev/codex-supervisor-self-clean/.local/memory/TommyKammy-codex-supervisor/issue-1111/context-index.md`; `sed -n '1,260p' .codex-supervisor/issue-journal.md`; `git status --short --branch`; `git log --oneline --decorate -n 5`; `git diff -- .codex-supervisor/issue-journal.md`; `gh pr status`; `git remote -v`; `gh auth status`; `git show --stat --oneline --decorate --no-patch HEAD`; `git show --stat --format=medium --summary HEAD`; `gh repo view --json nameWithOwner,defaultBranchRef`; `git ls-remote --heads github codex/issue-1111`; `date -u +%Y-%m-%dT%H:%M:%SZ`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
