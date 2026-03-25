# Issue #1001: Subprocess capture bounds: add explicit stdout and stderr accumulation limits in runCommand

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1001
- Branch: codex/issue-1001
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: de4d74a49b741e75f2c2405646f8c2f61e1e96ea
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-25T14:59:46Z

## Latest Codex Summary
- Added bounded stdout/stderr accumulation to `runCommand` using a fixed-size head/tail buffer with a deterministic `\n...\n` truncation marker, and added focused regression tests for oversized stdout and stderr capture.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: `runCommand()` accumulated child `stdout` and `stderr` into unbounded strings, so a noisy subprocess could grow supervisor memory without limit even though the rendered error message was already truncated.
- What changed: added a 64 KiB bounded capture buffer per stream in `src/core/command.ts` that keeps the earliest output, latest output, and inserts a deterministic `\n...\n` marker once truncation occurs. Existing exit, timeout, and error semantics stay the same; timeout annotations are appended through the same bounded accumulator. Added focused tests in `src/core/command.test.ts` for large successful stdout and large failing stderr captures.
- Current blocker: none.
- Next exact step: monitor draft PR `#1020` for CI and review feedback, then address any failures or comments that come back.
- Verification gap: none locally after `npm ci`; `npx tsx --test src/core/command.test.ts` and `npm run build` both passed.
- Files touched: `src/core/command.ts`; `src/core/command.test.ts`; `.codex-supervisor/issue-journal.md`.
- Rollback concern: low; changes are isolated to subprocess output buffering and focused regression coverage.
- Last focused command: `npm run build`
- Exact failure reproduced: before the fix, the new tests failed because `result.stdout` and `CommandExecutionError.stderr` held the full ~200 KB child output with no truncation marker or bounded length.
- Commands run: `sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-1001/AGENTS.generated.md`; `sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-1001/context-index.md`; `sed -n '1,260p' .codex-supervisor/issue-journal.md`; `git status --short --branch`; `sed -n '1,260p' src/core/command.ts`; `sed -n '1,320p' src/core/command.test.ts`; `rg -n "TRUNCATION|truncat|bounded|stdout|stderr" src -g'*.ts'`; `rg -n "runCommand\\(" src`; `sed -n '1,220p' src/core/utils.ts`; `sed -n '1,140p' src/local-ci.ts`; `npx tsx --test src/core/command.test.ts`; `git diff -- src/core/command.ts src/core/command.test.ts`; `npm ci`; `npx tsx --test src/core/command.test.ts`; `npm run build`; `date -u +"%Y-%m-%dT%H:%M:%SZ"`; `git rev-parse HEAD`; `git add src/core/command.ts src/core/command.test.ts .codex-supervisor/issue-journal.md`; `git commit -m "Bound runCommand output capture"`; `gh pr status`; `git branch -vv`; `git remote -v`; `git push -u origin codex/issue-1001`; `gh pr view --json url,isDraft,headRefName,baseRefName,mergeStateStatus`; `gh pr create --draft --base main --head codex/issue-1001 --title "Issue #1001: Bound runCommand output capture" --body ...`; `gh pr view 1020 --json url,isDraft,headRefName,baseRefName,mergeStateStatus,headRefOid`; `date -u +"%Y-%m-%dT%H:%M:%SZ"`; `git add .codex-supervisor/issue-journal.md`; `git commit -m "Update issue 1001 journal after draft PR"`; `git push`; `git rev-parse HEAD`; `date -u +"%Y-%m-%dT%H:%M:%SZ"`.
- PR status: draft PR open at `https://github.com/TommyKammy/codex-supervisor/pull/1020` on head `423d85d79819ea86104a02d747fa0ccb2d9506a2`; current merge state status `UNSTABLE` pending CI.
### Scratchpad
- Leave `.codex-supervisor/replay/` untracked; it is local replay output, not part of the fix.
