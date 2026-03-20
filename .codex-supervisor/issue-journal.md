# Issue #726: Orphan cleanup visibility: surface prune candidates and eligibility reasons before deletion

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/726
- Branch: codex/issue-726
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: stabilizing
- Attempt count: 2 (implementation=2, repair=0)
- Last head SHA: 949f3dfaa33305aca643563a06c043598435a367
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-20T20:48:46Z

## Latest Codex Summary
Added orphan prune-candidate visibility to `doctor` without changing cleanup behavior. `src/recovery-reconciliation.ts` now exports a reusable orphan inspector that classifies untracked `issue-*` worktrees as `eligible`, `locked`, `recent`, or `unsafe_target`, and `src/doctor.ts` reports those candidates through the existing `worktrees` diagnostic summary/details. Focused regression coverage in [src/doctor.test.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-726/src/doctor.test.ts) covers representative classifications.

Published branch `codex/issue-726` and opened draft PR [#750](https://github.com/TommyKammy/codex-supervisor/pull/750) against `main`. The PR body now reflects the diagnostics-only scope and the previously completed focused verification. I left the untracked `.codex-supervisor/replay/` directory untouched.

Summary: Opened draft PR #750 and pushed journal refresh commit `949f3df`; CI is now pending on the draft PR.
State hint: waiting_ci
Blocked reason: none
Tests: `npx tsx --test src/run-once-cycle-prelude.test.ts src/supervisor/supervisor-execution-cleanup.test.ts src/doctor.test.ts`; `npm run build`
Failure signature: none
Next action: Monitor pending CI on PR #750 and address any failures or review feedback while keeping the change diagnostics-only.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: `#726` needs a narrow runtime visibility change, not a pruning-policy change: expose orphaned worktree prune candidates through diagnostics with deterministic eligibility reasons, while leaving actual cleanup behavior untouched.
- What changed: added focused `doctor` regression tests for orphan prune candidate reporting, extracted `inspectOrphanedWorkspacePruneCandidates()` in `src/recovery-reconciliation.ts`, wired `src/doctor.ts` to report orphan candidates in the existing `worktrees` diagnostic summary/details, pushed branch `codex/issue-726`, opened draft PR `#750`, and pushed a follow-up journal-only commit `949f3df`.
- Current blocker: none
- Next exact step: watch pending GitHub Actions on PR `#750` (`build` on `ubuntu-latest` and `macos-latest`) and keep any follow-up scoped to diagnostics visibility only.
- Verification gap: full repo test suite was not rerun; verification this turn is the focused orphan-cleanup/doctor tests plus `npm run build`.
- Files touched: `src/doctor.test.ts`, `src/doctor.ts`, `src/recovery-reconciliation.ts`, `.codex-supervisor/issue-journal.md`
- Rollback concern: reverting these changes would remove the only operator-visible, testable classification of orphan prune candidates before cleanup policy changes land.
- Last focused commands:
```bash
sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-726/AGENTS.generated.md
sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-726/context-index.md
sed -n '1,320p' .codex-supervisor/issue-journal.md
git status --short --branch
gh pr status
git branch -vv
git log --oneline --decorate -n 5
git show --stat --oneline --decorate HEAD
git remote -v
git push -u origin codex/issue-726
gh pr create --draft --base main --head codex/issue-726 --title "Surface orphan prune candidates in doctor" --body "..."
gh pr view --json number,url,state,isDraft,headRefName,baseRefName
gh pr view 750 --json title,body,url
gh pr edit 750 --body-file - <<'EOF'
...
EOF
gh api repos/TommyKammy/codex-supervisor/pulls/750 -X PATCH --raw-field body=$'...'
gh pr view 750 --json url,isDraft,state,mergeStateStatus,headRefName,baseRefName
git add .codex-supervisor/issue-journal.md && git commit -m "chore: update issue 726 journal after draft PR" && git push
gh pr view 750 --json url,isDraft,state,headRefOid,mergeStateStatus
gh pr checks 750
date -u +"%Y-%m-%dT%H:%M:%SZ"
```
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
