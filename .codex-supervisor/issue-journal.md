# Issue #1101: CI path gate: block PRs that commit workstation-local absolute paths

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1101
- Branch: codex/issue-1101
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: repairing_ci
- Attempt count: 2 (implementation=1, repair=1)
- Last head SHA: 37d067559bedcb55b6c7fcc97835774b99c9a790
- Blocked reason: none
- Last failure signature: build (ubuntu-latest):fail
- Repeated failure signature count: 2
- Updated at: 2026-03-27T05:38:44.000Z

## Latest Codex Summary
The new CI gate was correct, but the branch failed because `github/main` already contained an intentional dashboard fixture with a macOS-style workstation path token that was not explicitly excluded from the workstation-local path detector. I merged `github/main` into `codex/issue-1101`, added `src/backend/webui-dashboard.test.ts` to the detector's repo-owned default exclusions, added a focused detector regression proving that explicit exclusion, and reran the Ubuntu-side CI commands locally.

Summary: Repaired the failing Ubuntu CI run by explicitly excluding the existing dashboard fixture from `verify:paths`, merged `github/main`, and revalidated the merged branch locally.
State hint: repairing_ci
Blocked reason: none
Tests: `npm run verify:paths`; `npx tsx --test src/workstation-local-path-detector.test.ts src/ci-workflow.test.ts`; `npx tsx src/index.ts replay-corpus`; `npm run test:malformed-inventory-regressions`; `npm run test:managed-restart-regressions`; `npm run build`
Next action: Commit the detector exclusion and journal update, push `codex/issue-1101`, and confirm PR `#1104` reruns clean on the new head
Failure signature: build (ubuntu-latest):fail

## Active Failure Context
- Category: checks
- Summary: PR `#1104` still shows the pre-fix failing Ubuntu build until a new head commit is pushed.
- Command or source: `gh pr checks`
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/1104
- Details:
  - `build (ubuntu-latest)` failed because `npm run verify:paths` flagged `src/backend/webui-dashboard.test.ts:620` as matching the detector's macOS workstation prefix.

## Codex Working Notes
### Current Handoff
- Hypothesis: the CI path gate itself is correct; the remaining failure came from an existing repo-owned fixture introduced from `github/main` that now needs an explicit exclusion so clean PRs pass while non-exempt tracked artifacts still fail.
- What changed: reproduced the failing detector output locally after `npm ci`, confirmed `src/backend/webui-dashboard.test.ts:620` was the offending tracked fixture, added that path to `DEFAULT_EXCLUDED_PATHS` in `scripts/check-workstation-local-paths.ts`, added a focused regression in `src/workstation-local-path-detector.test.ts`, merged `github/main` into the issue branch, resolved the tracked journal conflict in favor of the issue-1101 journal, and reran the high-signal Ubuntu-side checks successfully.
- Current blocker: none locally.
- Next exact step: create the repair commit, push the updated branch, and watch PR `#1104` for a clean rerun of the Ubuntu build.
- Verification gap: local verification now covers the same Ubuntu-side commands the workflow runs, but the repaired commit has not yet been pushed through a live GitHub Actions rerun.
- Files touched: `scripts/check-workstation-local-paths.ts`; `src/workstation-local-path-detector.test.ts`; `.codex-supervisor/issue-journal.md`.
- Rollback concern: low. The change does not weaken the detector globally; it only records one existing repo-owned fixture as an explicit exclusion and locks that expectation in with a focused test.
- Last focused command: `npm run build`
- What changed this turn: reread the required memory files and issue journal, inspected PR `#1104` checks and merge state, reproduced the detector failure locally, identified the existing dashboard fixture as the offending tracked path, patched the explicit exclusion list and detector coverage, merged `github/main`, and reran the relevant verification commands on the merged branch.
- Exact failure reproduced this turn: `npm run verify:paths` failed because `src/backend/webui-dashboard.test.ts:620` matched the detector's macOS workstation prefix in an existing dashboard fixture.
- Commands run this turn: `sed -n '1,220p' <skill-path>/SKILL.md`; `sed -n '1,220p' .local/memory/.../AGENTS.generated.md`; `sed -n '1,240p' .local/memory/.../context-index.md`; `sed -n '1,320p' .codex-supervisor/issue-journal.md`; `gh auth status`; `git branch --show-current`; `git status --short`; `gh pr checks 1104`; `gh pr view 1104 --json number,url,mergeStateStatus,mergeable,headRefName,headRefOid,baseRefName,statusCheckRollup`; `git fetch github main`; `git rev-list --left-right --count github/main...HEAD`; `gh run view 23631010761 --json name,workflowName,event,status,conclusion,url,headSha,headBranch,jobs`; `gh api /repos/TommyKammy/codex-supervisor/actions/jobs/68830089900`; `npm ci`; `npm run verify:paths`; `git grep -n -E '<unix-home-prefix>|<macos-users-prefix>|<windows-users-prefix>' -- . ':(exclude)docs/examples/atlaspm.supervisor.config.example.json' ':(exclude)docs/examples/atlaspm.md' ':(exclude)src/index.test.ts'`; `sed -n '580,660p' src/backend/webui-dashboard.test.ts`; `rg -n "check-workstation-local-paths|DEFAULT_EXCLUDED_PATHS|verify:paths|exclude-path|webui-dashboard" src scripts .github`; `sed -n '1,260p' src/workstation-local-path-detector.test.ts`; `npx tsx --test src/workstation-local-path-detector.test.ts src/ci-workflow.test.ts`; `git stash push --include-untracked -m "issue-1101-supervisor-artifacts-before-main-merge" -- .codex-supervisor/issue-journal.md .codex-supervisor/pre-merge .codex-supervisor/replay .codex-supervisor/turn-in-progress.json`; `git merge github/main`; `git show HEAD:.codex-supervisor/issue-journal.md`; `git add .codex-supervisor/issue-journal.md`; `npm run verify:paths`; `npx tsx src/index.ts replay-corpus`; `npm run test:malformed-inventory-regressions`; `npm run test:managed-restart-regressions`; `npm run build`; `git commit -m "Merge github/main into codex/issue-1101"`; `git stash pop`; `git rev-parse HEAD`; `date -u +%Y-%m-%dT%H:%M:%S.000Z`; `git status --short --branch`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
