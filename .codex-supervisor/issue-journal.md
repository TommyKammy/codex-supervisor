# Issue #1032: Test hygiene: clean up temporary workspace directories in interrupted-turn execution coverage

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1032
- Branch: codex/issue-1032
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: draft_pr
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: f0e55f8fa86a2f75815b365c9488ce429b5be341
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-25T21:43:04Z

## Latest Codex Summary
- Reproduced the interrupted-turn test hygiene issue locally by rerunning the focused test file and confirming orphaned `/tmp/codex-turn-marker-*` directories persisted.
- Added a test-only `withTempWorkspace(...)` helper plus a regression that proves cleanup still runs when the test body throws, without changing runtime interrupted-turn behavior.
- Focused verification now passes: `npx tsx --test src/run-once-turn-execution.test.ts` and `npm run build`.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the interrupted-turn coverage only leaks temp workspaces because the test allocates a real `fs.mkdtemp(...)` directory without a guaranteed `finally` cleanup.
- What changed: wrapped the temp workspace creation in a test helper that always removes the directory and added a regression test that forces the helper body to throw before asserting the workspace is gone afterward.
- Current blocker: none locally.
- Next exact step: monitor draft PR `#1033` and address any review or CI feedback if it appears.
- Verification gap: none for the requested local checks after installing dependencies with `npm ci`.
- Files touched: `src/run-once-turn-execution.test.ts`, `.codex-supervisor/issue-journal.md`.
- Rollback concern: low; the code change is isolated to test hygiene and does not alter production interrupted-turn behavior.
- Last focused command: `gh pr view 1033 --json number,isDraft,state,url,headRefName,baseRefName`
- Exact failure reproduced: before the test fix, `npx tsx --test src/run-once-turn-execution.test.ts` passed but left orphaned `/tmp/codex-turn-marker-*` directories behind because the interrupted-turn coverage created a real temp workspace and never removed it.
- Commands run: `sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-1032/AGENTS.generated.md`; `sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-1032/context-index.md`; `sed -n '1,260p' .codex-supervisor/issue-journal.md`; `git status --short --branch`; `rg -n "mkdtemp|interrupted-turn|workspace" src/run-once-turn-execution.test.ts`; `sed -n '1,260p' src/run-once-turn-execution.test.ts`; `sed -n '620,760p' src/run-once-turn-execution.test.ts`; `npx tsx --test src/run-once-turn-execution.test.ts`; `find /tmp -maxdepth 1 -type d -name 'codex-turn-marker-*' | sort`; `sed -n '760,860p' src/run-once-turn-execution.test.ts`; `git diff -- src/run-once-turn-execution.test.ts`; `test -f package-lock.json && echo lockfile-present || echo no-lockfile`; `test -x node_modules/.bin/tsc && echo tsc-present || echo tsc-missing`; `sed -n '1,220p' package.json`; `npm ci`; `npm run build`; `git add .codex-supervisor/issue-journal.md src/run-once-turn-execution.test.ts`; `git commit -m "Issue #1032: clean interrupted-turn temp workspaces"`; `git rev-parse HEAD`; `gh pr view --json number,isDraft,state,url,headRefName,baseRefName`; `git push -u origin codex/issue-1032`; `gh pr create --draft --base main --head codex/issue-1032 --title "Issue #1032: clean interrupted-turn temp workspaces" --body ...`; `date -u +"%Y-%m-%dT%H:%M:%SZ"`; `gh pr view 1033 --json number,isDraft,state,url,headRefName,baseRefName`.
- PR status: draft PR `#1033` open at https://github.com/TommyKammy/codex-supervisor/pull/1033 targeting `main` from `codex/issue-1032`.
### Scratchpad
- Leave `.codex-supervisor/replay/` untracked; it is local replay output, not part of the fix.
