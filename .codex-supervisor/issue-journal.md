# Issue #726: Orphan cleanup visibility: surface prune candidates and eligibility reasons before deletion

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/726
- Branch: codex/issue-726
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: stabilizing
- Attempt count: 2 (implementation=2, repair=0)
- Last head SHA: a180716fc554a57add73f6569895b9934b32e5ae
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-20T20:47:35Z

## Latest Codex Summary
Added orphan prune-candidate visibility to `doctor` without changing cleanup behavior. `src/recovery-reconciliation.ts` now exports a reusable orphan inspector that classifies untracked `issue-*` worktrees as `eligible`, `locked`, `recent`, or `unsafe_target`, and `src/doctor.ts` reports those candidates through the existing `worktrees` diagnostic summary/details. Focused regression coverage in [src/doctor.test.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-726/src/doctor.test.ts) covers representative classifications.

Published branch `codex/issue-726` and opened draft PR [#750](https://github.com/TommyKammy/codex-supervisor/pull/750) against `main`. The PR body now reflects the diagnostics-only scope and the previously completed focused verification. I left the untracked `.codex-supervisor/replay/` directory untouched.

Summary: Opened draft PR #750 for the orphan prune-candidate visibility change on commit `a180716`.
State hint: draft_pr
Blocked reason: none
Tests: `npx tsx --test src/run-once-cycle-prelude.test.ts src/supervisor/supervisor-execution-cleanup.test.ts src/doctor.test.ts`; `npm run build`
Failure signature: none
Next action: Monitor PR #750 and address any CI or review feedback while keeping the change diagnostics-only.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: `#726` needs a narrow runtime visibility change, not a pruning-policy change: expose orphaned worktree prune candidates through diagnostics with deterministic eligibility reasons, while leaving actual cleanup behavior untouched.
- What changed: added focused `doctor` regression tests for orphan prune candidate reporting, extracted `inspectOrphanedWorkspacePruneCandidates()` in `src/recovery-reconciliation.ts`, wired `src/doctor.ts` to report orphan candidates in the existing `worktrees` diagnostic summary/details, pushed branch `codex/issue-726`, and opened draft PR `#750`.
- Current blocker: none
- Next exact step: watch PR `#750` for CI or review feedback and keep any follow-up scoped to diagnostics visibility only.
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
date -u +"%Y-%m-%dT%H:%M:%SZ"
```
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
