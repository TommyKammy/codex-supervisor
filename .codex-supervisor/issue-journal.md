# Issue #1111: Prevent artificial PR merge conflicts from the shared committed issue journal path

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1111
- Branch: codex/issue-1111
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: resolving_conflict
- Attempt count: 2 (implementation=2, repair=0)
- Last head SHA: 5448e5669a9c6ea3a193de21d9ab71d70544470d
- Blocked reason: none
- Last failure signature: artificial-journal-merge-conflict
- Repeated failure signature count: 0
- Updated at: 2026-03-27T10:30:52Z

## Latest Codex Summary
Implemented the issue-scoped journal-path fix, committed it on `248c45e` (`Prevent shared journal merge conflicts`), published the branch to GitHub, and opened draft PR `#1112`: https://github.com/TommyKammy/codex-supervisor/pull/1112

After opening the PR, GitHub reported `mergeStateStatus=DIRTY`. Fetching `github/main` and merging it into `codex/issue-1111` reproduced the only manual conflict in `.codex-supervisor/issue-journal.md`, while the implementation files auto-merged. This reproduces the current bug using the live branch flow the issue describes. The next step is to finish the merge, rerun the focused verification ring, and push the conflict-resolution commit so the PR can be re-evaluated.

Summary: Draft PR `#1112` is open, integrating current `main` reproduced the artificial shared-journal merge conflict, and the branch is mid-resolution with only the journal requiring manual repair.
State hint: resolving_conflict
Blocked reason: none
Tests: not rerun yet after merging `github/main`
Next action: complete the merge by keeping the current issue journal handoff, rerun the focused tests around the journal-path change, push the merge resolution, and confirm PR `#1112` leaves `DIRTY`.
Failure signature: artificial-journal-merge-conflict

## Active Failure Context
- Category: conflict
- Summary: PR #1112 became DIRTY after publish and `git merge github/main` reproduced a content conflict in `.codex-supervisor/issue-journal.md`.
- Command or source: `gh pr view 1112 --json mergeStateStatus`; `git merge --no-edit github/main`
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/1112
- Details:
  - mergeStateStatus=DIRTY
  - `git diff --name-only --diff-filter=U` reported only `.codex-supervisor/issue-journal.md`

## Codex Working Notes
### Current Handoff
- Hypothesis: the durable handoff can stay committed, but the default journal path must be issue-scoped so unrelated branches stop competing on one tracked `.codex-supervisor/issue-journal.md` file.
- What changed: switched the default journal template to `.codex-supervisor/issues/{issueNumber}/issue-journal.md`, resolved the template wherever a journal path is synthesized, updated replay-corpus normalization to keep the issue-scoped path, and added a focused git-based regression that merges one unrelated issue branch into `main` before merging `main` into another issue branch.
- Current blocker: none locally.
- Next exact step: `git add .codex-supervisor/issue-journal.md`, finish the merge commit, rerun the focused journal/preparation/workspace/replay/supervisor tests, push the updated branch, and recheck PR `#1112`.
- Verification gap: I have not run the full repository suite or an end-to-end supervisor publication flow; verification so far covers focused journal, preparation, selection, replay, supervisor stale-state, and the new merge-conflict reproduction path. Post-merge verification is still pending.
- Files touched: `src/core/journal.ts`; `src/core/config.ts`; `src/run-once-issue-preparation.ts`; `src/run-once-issue-selection.ts`; `src/supervisor/supervisor.ts`; `src/supervisor/replay-corpus-config.ts`; `src/supervisor/replay-corpus-promotion.ts`; `src/core/workspace.test.ts`; `src/journal.test.ts`; `src/run-once-issue-preparation.test.ts`; `src/supervisor/replay-corpus-config.test.ts`; `src/supervisor/replay-corpus-promotion.test.ts`; `src/index.test.ts`; `.codex-supervisor/issue-journal.md`.
- Rollback concern: low. The behavioral change is confined to default journal-path synthesis; explicit custom `issueJournalRelativePath` values still work, and the new regression already proved unrelated issue branches no longer conflict only because of journal persistence in the issue-scoped design.
- Last focused command: `git merge --no-edit github/main`
- What changed this turn: reread the required memory files and journal, confirmed the committed checkpoint `248c45e`, added a journal-only handoff commit `5448e56`, pushed `codex/issue-1111` to the GitHub remote, opened draft PR `#1112`, fetched the latest `github/main`, and reproduced the live merge conflict where only `.codex-supervisor/issue-journal.md` requires manual resolution.
- Exact failure reproduced this turn: after `gh pr view 1112` reported `mergeStateStatus=DIRTY`, `git merge --no-edit github/main` failed with a content conflict in `.codex-supervisor/issue-journal.md` while implementation files auto-merged.
- Commands run this turn: `sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self-clean/.local/memory/TommyKammy-codex-supervisor/issue-1111/AGENTS.generated.md`; `sed -n '1,260p' /home/tommy/Dev/codex-supervisor-self-clean/.local/memory/TommyKammy-codex-supervisor/issue-1111/context-index.md`; `sed -n '1,260p' .codex-supervisor/issue-journal.md`; `git status --short --branch`; `git log --oneline --decorate -n 5`; `git diff -- .codex-supervisor/issue-journal.md`; `gh pr status`; `git remote -v`; `sed -n '1,220p' /home/tommy/.codex/plugins/cache/openai-curated/github/c33798c8a1e6da61a75e06e33ceae39a35f05ea5/skills/yeet/SKILL.md`; `gh auth status`; `git show --stat --oneline --decorate --no-patch HEAD`; `git show --stat --format=medium --summary HEAD`; `gh repo view --json nameWithOwner,defaultBranchRef`; `git ls-remote --heads github codex/issue-1111`; `date -u +%Y-%m-%dT%H:%M:%SZ`; `git add .codex-supervisor/issue-journal.md`; `git commit -m "Update issue #1111 journal handoff"`; `git push -u github codex/issue-1111`; `gh pr create --draft --base main --head codex/issue-1111 --title '[codex] Prevent shared journal merge conflicts' --body-file <tempfile>`; `gh pr view 1112 --json url,isDraft,mergeStateStatus,headRefName,baseRefName`; `git fetch github main`; `gh pr diff 1112 --name-only`; `git merge --no-edit github/main`; `git status --short`; `git diff --name-only --diff-filter=U`; `git diff -- src/core/journal.ts src/run-once-issue-preparation.test.ts src/run-once-issue-preparation.ts src/supervisor/supervisor.ts`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
