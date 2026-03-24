# Issue #948: Path hygiene check: add a focused detector for workstation-local absolute paths

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/948
- Branch: codex/issue-948
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: resolving_conflict
- Attempt count: 3 (implementation=2, repair=1)
- Last head SHA: 1a7de4ece72e5cea983b363dc39315ad5ad80453
- Blocked reason: none
- Last failure signature: dirty:1a7de4ece72e5cea983b363dc39315ad5ad80453
- Repeated failure signature count: 1
- Updated at: 2026-03-24T17:04:56.568Z

## Latest Codex Summary
Added a focused detector in [scripts/check-workstation-local-paths.ts](scripts/check-workstation-local-paths.ts) and a targeted runtime regression in [src/workstation-local-path-detector.test.ts](src/workstation-local-path-detector.test.ts). The script scans tracked text artifacts via `git ls-files`, skips binaries, flags common workstation-local absolute-path prefixes, and documents the narrow repo-relative exclusion surface for intentional examples and fixtures.

I also updated [issue-journal.md](.codex-supervisor/issue-journal.md), committed the work as `389ad63` plus a journal refresh `1a7de4e`, pushed `codex/issue-948`, and opened draft PR `#963`: https://github.com/TommyKammy/codex-supervisor/pull/963. Focused verification passed. Full build verification is still unavailable here because `npm run build` fails with `tsc: not found`, and `npx tsc -p tsconfig.json` confirms `typescript` is not installed in this worktree.

Summary: Added the workstation-local path detector, proved clean/fail/exempt behavior with a focused test, pushed branch `codex/issue-948`, and opened draft PR #963
State hint: draft_pr
Blocked reason: none
Tests: `npx tsx --test src/workstation-local-path-detector.test.ts`; `npx tsx scripts/check-workstation-local-paths.ts`; `npm run build` failed because `tsc` is not installed; `npx tsc -p tsconfig.json` reported `typescript` is not installed
Next action: Integrate `origin/main`, rerun the focused detector verification, and push the updated branch
Failure signature: dirty:1a7de4ece72e5cea983b363dc39315ad5ad80453

## Active Failure Context
- Category: conflict
- Summary: PR #963 has merge conflicts and needs a base-branch integration pass.
- Command or source: `git fetch origin && git merge origin/<default-branch>`
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/963
- Details:
  - `mergeStateStatus=DIRTY`

## Codex Working Notes
### Current Handoff
- Hypothesis: a narrow standalone script is sufficient for issue #948 because the acceptance criteria only require detecting workstation-local absolute paths in durable committed artifacts without changing supervisor execution behavior.
- What changed: added [scripts/check-workstation-local-paths.ts](scripts/check-workstation-local-paths.ts) with a default repo-relative exclusion surface for intentionally committed examples/tests, `git ls-files`-based tracked-file scanning, binary-file skipping, and clear usage/error output; added [src/workstation-local-path-detector.test.ts](src/workstation-local-path-detector.test.ts) to exercise a clean repository pass, a tracked injected workstation-local path failure, and an explicit `--exclude-path` exemption.
- Current blocker: none.
- Next exact step: finish resolving the `origin/main` merge, rerun the focused detector verification, refresh this journal with the merged head SHA, and push `codex/issue-948`.
- Verification gap: focused coverage is complete for the new detector, but full TypeScript build verification is currently unavailable in this worktree because `tsc`/`typescript` is not installed locally.
- Files touched: [.codex-supervisor/issue-journal.md](.codex-supervisor/issue-journal.md), [scripts/check-workstation-local-paths.ts](scripts/check-workstation-local-paths.ts), [src/workstation-local-path-detector.test.ts](src/workstation-local-path-detector.test.ts), [src/supervisor/supervisor.ts](src/supervisor/supervisor.ts), and [src/supervisor/supervisor-stale-no-pr-branch-state.test.ts](src/supervisor/supervisor-stale-no-pr-branch-state.test.ts).
- Rollback concern: low; reverting this merge resolution would either restore the dirty PR state or drop the workstation-local path detector and the base-branch stale no-PR fix now present on `origin/main`.
- Last focused command: `git merge origin/main`
- Last focused failure: merge conflict in `.codex-supervisor/issue-journal.md`; no code-file conflicts were reported.
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
```
### Scratchpad
- Leave `.codex-supervisor/replay/` untracked; it is local replay output, not part of the fix.
