# Issue #1002: Subprocess error hygiene follow-up: preserve actionable timeout and failure summaries under bounded capture

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1002
- Branch: codex/issue-1002
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: stabilizing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: bcea89a9dbb6c0a6f970e096048a53de4a3dc4ed
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-25T15:14:07Z

## Latest Codex Summary
- Added head-and-tail truncation for operator-facing subprocess failure summaries so bounded stderr/stdout still keeps actionable timeout and failure lines, and covered the regression in shared failure-context and local CI tests.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: bounded `runCommand()` capture now preserves both ends, but several downstream summaries still applied head-only `truncate(...)`, so noisy stderr could drop the tail where timeout and final failure lines live.
- What changed: added `truncatePreservingStartAndEnd()` in `src/core/utils.ts` and switched operator-facing failure summaries in `src/local-ci.ts`, `src/supervisor/agent-runner.ts`, `src/supervisor/supervisor-failure-helpers.ts`, and `src/turn-execution-failure-helpers.ts` to use it. Added focused regressions in `src/local-ci.test.ts`, `src/supervisor/agent-runner.test.ts`, and `src/turn-execution-failure-helpers.test.ts` to prove timeout summaries remain visible with explicit `\n...\n` truncation markers.
- Current blocker: none.
- Next exact step: stage the issue #1002 changes, commit them on `codex/issue-1002`, and open or update the draft PR if needed.
- Verification gap: none locally after `npm ci`; `npx tsx --test src/core/command.test.ts src/cli/supervisor-runtime.test.ts src/doctor.test.ts src/local-ci.test.ts src/supervisor/agent-runner.test.ts src/turn-execution-failure-helpers.test.ts` and `npm run build` both passed.
- Files touched: `src/core/utils.ts`; `src/local-ci.ts`; `src/local-ci.test.ts`; `src/supervisor/agent-runner.ts`; `src/supervisor/agent-runner.test.ts`; `src/supervisor/supervisor-failure-helpers.ts`; `src/turn-execution-failure-helpers.ts`; `src/turn-execution-failure-helpers.test.ts`; `.codex-supervisor/issue-journal.md`.
- Rollback concern: low; changes stay in summary-rendering paths and focused regression coverage without changing subprocess execution semantics.
- Last focused command: `npm run build`
- Exact failure reproduced: before the fix, a long bounded stderr still lost its trailing timeout line after a second head-only truncation in shared summaries; an ad hoc `createCodexAgentRunner()` repro printed `HAS_TIMEOUT false` even though the stderr ended with `Command timed out after 1800000ms: codex exec`.
- Commands run: `sed -n '1,240p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-1002/AGENTS.generated.md`; `sed -n '1,240p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-1002/context-index.md`; `sed -n '1,320p' .codex-supervisor/issue-journal.md`; `git status --short --branch`; `sed -n '1,260p' src/core/command.ts`; `sed -n '1,260p' src/core/command.test.ts`; `sed -n '1,260p' src/cli/supervisor-runtime.test.ts`; `sed -n '1,260p' src/doctor.test.ts`; `rg -n "timed out|timeout|stderr|stdout|truncat|bounded|CommandExecutionError|runCommand\\(" src -g'*.ts'`; `sed -n '1,240p' src/local-ci.ts`; `sed -n '1,280p' src/supervisor/agent-runner.ts`; `sed -n '1,320p' src/doctor.ts`; `sed -n '1,260p' src/cli/supervisor-runtime.ts`; `sed -n '1,260p' src/core/utils.ts`; `sed -n '1,220p' src/local-ci.test.ts`; `sed -n '1,240p' src/supervisor/supervisor-failure-helpers.ts`; `git log --oneline --decorate -5`; `sed -n '380,460p' src/doctor.test.ts`; `sed -n '1,220p' src/build.test.ts`; `sed -n '1,220p' src/local-review/runner.ts`; `sed -n '1,220p' src/supervisor/supervisor-execution-orchestration.test.ts`; `sed -n '430,520p' src/supervisor/agent-runner.test.ts`; `sed -n '1,220p' src/supervisor/agent-runner.test.ts`; `npx tsx -e '...'`; `sed -n '1,280p' src/turn-execution-failure-helpers.ts`; `sed -n '1,260p' src/supervisor/supervisor-recovery-failure-flows.test.ts`; `sed -n '1,220p' src/turn-execution-failure-helpers.test.ts`; `npx tsx --test src/local-ci.test.ts`; `npx tsx --test src/supervisor/agent-runner.test.ts`; `npx tsx --test src/turn-execution-failure-helpers.test.ts`; `npx tsx --test src/core/command.test.ts src/cli/supervisor-runtime.test.ts src/doctor.test.ts src/local-ci.test.ts src/supervisor/agent-runner.test.ts src/turn-execution-failure-helpers.test.ts`; `npm run build`; `test -d node_modules/typescript && echo installed || echo missing`; `test -f package-lock.json && echo lock-present || echo no-lock`; `npm ci`; `npm run build`; `git diff -- src/core/utils.ts src/local-ci.ts src/local-ci.test.ts src/supervisor/agent-runner.ts src/supervisor/agent-runner.test.ts src/supervisor/supervisor-failure-helpers.ts src/turn-execution-failure-helpers.ts src/turn-execution-failure-helpers.test.ts .codex-supervisor/issue-journal.md`; `date -u +"%Y-%m-%dT%H:%M:%SZ"`; `git rev-parse HEAD`.
- PR status: none yet for issue #1002.
### Scratchpad
- Leave `.codex-supervisor/replay/` untracked; it is local replay output, not part of the fix.
