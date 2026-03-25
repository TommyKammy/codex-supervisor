# Issue #1032: Test hygiene: clean up temporary workspace directories in interrupted-turn execution coverage

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1032
- Branch: codex/issue-1032
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 9a405794a31518aaa1fe486450c96717e0154bfb
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-25T21:41:43Z

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
- Next exact step: stage the focused test changes, commit them on `codex/issue-1032`, and open or update the issue PR if needed.
- Verification gap: none for the requested local checks after installing dependencies with `npm ci`.
- Files touched: `src/run-once-turn-execution.test.ts`, `.codex-supervisor/issue-journal.md`.
- Rollback concern: low; the code change is isolated to test hygiene and does not alter production interrupted-turn behavior.
- Last focused command: `npm run build`
- Exact failure reproduced: before the test fix, `npx tsx --test src/run-once-turn-execution.test.ts` passed but left orphaned `/tmp/codex-turn-marker-*` directories behind because the interrupted-turn coverage created a real temp workspace and never removed it.
- Commands run: `sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-1032/AGENTS.generated.md`; `sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-1032/context-index.md`; `sed -n '1,260p' .codex-supervisor/issue-journal.md`; `git status --short --branch`; `rg -n "mkdtemp|interrupted-turn|workspace" src/run-once-turn-execution.test.ts`; `sed -n '1,260p' src/run-once-turn-execution.test.ts`; `sed -n '620,760p' src/run-once-turn-execution.test.ts`; `npx tsx --test src/run-once-turn-execution.test.ts`; `find /tmp -maxdepth 1 -type d -name 'codex-turn-marker-*' | sort`; `sed -n '760,860p' src/run-once-turn-execution.test.ts`; `git diff -- src/run-once-turn-execution.test.ts`; `test -f package-lock.json && echo lockfile-present || echo no-lockfile`; `test -x node_modules/.bin/tsc && echo tsc-present || echo tsc-missing`; `sed -n '1,220p' package.json`; `npm ci`; `npm run build`; `date -u +"%Y-%m-%dT%H:%M:%SZ"`.
- PR status: no PR opened from `codex/issue-1032` yet in this turn.
### Scratchpad
- Leave `.codex-supervisor/replay/` untracked; it is local replay output, not part of the fix.
