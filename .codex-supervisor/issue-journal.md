# Issue #948: Path hygiene check: add a focused detector for workstation-local absolute paths

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/948
- Branch: codex/issue-948
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 4 (implementation=2, repair=2)
- Last head SHA: e89f719f772b3811aaccda0bc9d2bb82a6b6b0d9
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ852fkSD
- Repeated failure signature count: 1
- Updated at: 2026-03-24T17:27:17.108Z

## Latest Codex Summary
Merged `origin/main` into `codex/issue-948`, resolved the only conflict in [.codex-supervisor/issue-journal.md](.codex-supervisor/issue-journal.md), and preserved the upstream `main` changes in [src/supervisor/supervisor.ts](src/supervisor/supervisor.ts) and [src/supervisor/supervisor-stale-no-pr-branch-state.test.ts](src/supervisor/supervisor-stale-no-pr-branch-state.test.ts). During verification, the new detector correctly flagged workstation-local absolute paths that had been introduced into the journal during conflict resolution, so I converted those references back to repo-relative form and refreshed the journal.

Focused tests passed, `npm ci` installed the declared local dependencies, and `npm run build` now passes. I pushed `e89f719` to `origin/codex/issue-948`; PR [#963](https://github.com/TommyKammy/codex-supervisor/pull/963) is still draft/open and now reports `mergeStateStatus=UNSTABLE` instead of `DIRTY`. The worktree is clean apart from the expected untracked `.codex-supervisor/pre-merge/` and `.codex-supervisor/replay/` directories.

Summary: Merged origin/main, resolved the journal conflict, fixed the journal-local path regression, reran focused verification plus build, and pushed codex/issue-948
State hint: waiting_ci
Blocked reason: none
Tests: `npx tsx --test src/workstation-local-path-detector.test.ts src/supervisor/supervisor-stale-no-pr-branch-state.test.ts src/supervisor/supervisor-recovery-reconciliation.test.ts src/supervisor/supervisor-execution-orchestration.test.ts`; `npx tsx scripts/check-workstation-local-paths.ts`; `npm ci`; `npm run build`
Next action: Monitor PR #963 CI and review feedback, and repair any environment-independent failures on `codex/issue-948`
Failure signature: PRRT_kwDORgvdZ852fkSD

## Active Failure Context
- Category: review
- Summary: 1 unresolved automated review thread(s) remain.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/963#discussion_r2983147933
- Details:
  - scripts/check-workstation-local-paths.ts:89 _⚠️ Potential issue_ | _🟡 Minor_ **Normalize exclude paths canonically before matching tracked files.** At Line 87, `normalizeRepoRelativePath` does not normalize prefixes like `./`, so `--exclude-path ./docs/guide.md` will not match tracked `docs/guide.md`. <details> <summary>Proposed fix</summary> ```diff function normalizeRepoRelativePath(filePath: string): string { - return filePath.replaceAll(path.sep, "/"); + const slashNormalized = filePath.replace(/\\/g, "/"); + return path.posix.normalize(slashNormalized).replace(/^\.\//, ""); } ``` </details> <details> <summary>🤖 Prompt for AI Agents</summary> ``` Verify each finding against the current code and only fix it if needed. In `@scripts/check-workstation-local-paths.ts` around lines 87 - 89, normalizeRepoRelativePath currently only replaces OS separators and therefore fails to match paths passed with a "./" prefix; update normalizeRepoRelativePath to canonicalize prefixes as well by converting path.sep to "/", then removing any leading "./" (and redundant "./" sequences) and normalizing duplicate slashes so that inputs like "./docs/guide.md" become "docs/guide.md" before matching; adjust the function (normalizeRepoRelativePath) to perform these canonicalizations so exclude-path arguments match tracked file paths. ``` </details> <!-- fingerprinting:phantom:poseidon:hawk --> <!-- This is an auto-generated comment by CodeRabbit -->

## Codex Working Notes
### Current Handoff
- Hypothesis: the standalone detector remains sufficient for issue #948, and the only base-integration risk was the tracked issue journal because `origin/main` updated the same path for issue #946.
- What changed: merged `origin/main` into this branch, bringing in the upstream updates to [src/supervisor/supervisor.ts](src/supervisor/supervisor.ts) and [src/supervisor/supervisor-stale-no-pr-branch-state.test.ts](src/supervisor/supervisor-stale-no-pr-branch-state.test.ts). Resolved the conflict in [.codex-supervisor/issue-journal.md](.codex-supervisor/issue-journal.md) to the issue-948 content, then fixed the detector-reported workstation-local absolute-path references introduced during that resolution by converting the journal links and command examples back to repo-relative paths.
- Current blocker: none.
- Next exact step: monitor PR #963 CI and review feedback, then repair any environment-independent failures on `codex/issue-948`.
- Verification gap: none; the focused detector checks and `npm run build` pass after `npm ci`.
- Files touched: [.codex-supervisor/issue-journal.md](.codex-supervisor/issue-journal.md), [scripts/check-workstation-local-paths.ts](scripts/check-workstation-local-paths.ts), [src/workstation-local-path-detector.test.ts](src/workstation-local-path-detector.test.ts), [src/supervisor/supervisor.ts](src/supervisor/supervisor.ts), and [src/supervisor/supervisor-stale-no-pr-branch-state.test.ts](src/supervisor/supervisor-stale-no-pr-branch-state.test.ts).
- Rollback concern: low; reverting the merge would restore PR #963 to a dirty state and drop the already-landed `main` fix from this branch.
- Last focused command: `gh pr view 963 --json url,isDraft,state,mergeStateStatus,headRefOid,headRefName,baseRefName`
- Last focused failure: none.
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
git commit -m "Update issue journal after merge resolution"
git push origin codex/issue-948
gh pr view 963 --json url,isDraft,state,mergeStateStatus,headRefOid,headRefName,baseRefName
git stash drop stash@{0}
```
### Scratchpad
- Leave `.codex-supervisor/replay/` untracked; it is local replay output, not part of the fix.
