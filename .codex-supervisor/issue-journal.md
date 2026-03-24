# Issue #948: Path hygiene check: add a focused detector for workstation-local absolute paths

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/948
- Branch: codex/issue-948
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: draft_pr
- Attempt count: 3 (implementation=2, repair=1)
- Last head SHA: bb64c3570ff8f587d9100450148cb85bbd062cfa
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-24T17:10:11+00:00

## Latest Codex Summary
Merged `origin/main` into `codex/issue-948` as `bb64c35`, preserving the workstation-local path detector from this branch and the stale no-PR base-diff fix that landed on `main`. The only merge conflict was [.codex-supervisor/issue-journal.md](.codex-supervisor/issue-journal.md), which I resolved back to the issue-948 journal content.

The rerun of [scripts/check-workstation-local-paths.ts](scripts/check-workstation-local-paths.ts) then caught a real regression in that journal resolution: I had copied workstation-local absolute-path links and command paths into the durable journal. I converted those references back to repo-relative paths, reran the focused detector and regression suite, installed the already-declared local dependencies with `npm ci`, and confirmed `npm run build` now passes in this worktree.

Summary: Merged `origin/main`, resolved the issue journal conflict, fixed the journal's own workstation-local path regression, and reran focused verification plus build
State hint: draft_pr
Blocked reason: none
Tests: `npx tsx --test src/workstation-local-path-detector.test.ts src/supervisor/supervisor-stale-no-pr-branch-state.test.ts src/supervisor/supervisor-recovery-reconciliation.test.ts src/supervisor/supervisor-execution-orchestration.test.ts`; `npx tsx scripts/check-workstation-local-paths.ts`; `npm ci`; `npm run build`
Next action: Push `codex/issue-948` and confirm draft PR #963 is no longer dirty, then monitor CI and review feedback
Failure signature: none

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the standalone detector remains sufficient for issue #948, and the only base-integration risk was the tracked issue journal because `origin/main` updated the same path for issue #946.
- What changed: merged `origin/main` into this branch, bringing in the upstream updates to [src/supervisor/supervisor.ts](src/supervisor/supervisor.ts) and [src/supervisor/supervisor-stale-no-pr-branch-state.test.ts](src/supervisor/supervisor-stale-no-pr-branch-state.test.ts). Resolved the conflict in [.codex-supervisor/issue-journal.md](.codex-supervisor/issue-journal.md) to the issue-948 content, then fixed the detector-reported workstation-local absolute-path references introduced during that resolution by converting the journal links and command examples back to repo-relative paths.
- Current blocker: none.
- Next exact step: commit this journal refresh, push `codex/issue-948`, and verify PR #963 reports a clean merge state again.
- Verification gap: none; the focused detector checks and `npm run build` pass after `npm ci`.
- Files touched: [.codex-supervisor/issue-journal.md](.codex-supervisor/issue-journal.md), [scripts/check-workstation-local-paths.ts](scripts/check-workstation-local-paths.ts), [src/workstation-local-path-detector.test.ts](src/workstation-local-path-detector.test.ts), [src/supervisor/supervisor.ts](src/supervisor/supervisor.ts), and [src/supervisor/supervisor-stale-no-pr-branch-state.test.ts](src/supervisor/supervisor-stale-no-pr-branch-state.test.ts).
- Rollback concern: low; reverting the merge would restore PR #963 to a dirty state and drop the already-landed `main` fix from this branch.
- Last focused command: `npm run build`
- Last focused failure: `npx tsx scripts/check-workstation-local-paths.ts` initially failed because [.codex-supervisor/issue-journal.md](.codex-supervisor/issue-journal.md) temporarily contained workstation-local absolute-path references from the conflict resolution; converting those entries to repo-relative paths fixed the failure.
- Draft PR: https://github.com/TommyKammy/codex-supervisor/pull/963
- Last focused commands:
```bash
sed -n '1,220p' ../codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-948/AGENTS.generated.md
sed -n '1,220p' ../codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-948/context-index.md
sed -n '1,320p' .codex-supervisor/issue-journal.md
git status --short --branch
git diff -- .codex-supervisor/issue-journal.md
git symbolic-ref --short refs/remotes/origin/HEAD
git branch -vv
git fetch origin
git diff --name-status origin/main...HEAD
git diff --name-status HEAD..origin/main
git rev-list --left-right --count HEAD...origin/main
git log --oneline --left-right HEAD...origin/main
git show --stat --oneline origin/main
git show origin/main:.codex-supervisor/issue-journal.md | sed -n '1,260p'
git stash push -m "pre-merge issue-948 journal" -- .codex-supervisor/issue-journal.md
git merge origin/main
git add .codex-supervisor/issue-journal.md
git diff --cached --stat
npx tsx --test src/workstation-local-path-detector.test.ts src/supervisor/supervisor-stale-no-pr-branch-state.test.ts src/supervisor/supervisor-recovery-reconciliation.test.ts src/supervisor/supervisor-execution-orchestration.test.ts
npx tsx scripts/check-workstation-local-paths.ts
npm run build
git add .codex-supervisor/issue-journal.md
npx tsx scripts/check-workstation-local-paths.ts
npm ci
npm run build
git commit -m "Merge origin/main into codex/issue-948"
git rev-parse HEAD
date -Iseconds -u
```
### Scratchpad
- Leave `.codex-supervisor/replay/` untracked; it is local replay output, not part of the fix.
