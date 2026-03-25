# Issue #1003: Subprocess durability coverage: exercise high-output child commands through supervisor-facing paths

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1003
- Branch: codex/issue-1003
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 0670f2e4a6f5445d9a679adc479a96182eccd955
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-25T15:40:59Z

## Latest Codex Summary
- Added subprocess-backed durability coverage for high-output supervisor-facing Codex runs and tightened the existing high-output `runCommand()` fixtures so they flush deterministically before exiting.

- Focused verification now passes for `src/core/command.test.ts`, `src/cli/supervisor-runtime.test.ts`, `src/supervisor/supervisor.test.ts`, and `src/supervisor/agent-runner.test.ts`, and `npm run build` passes after restoring local dependencies with `npm ci`.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: issue #1003 only needs coverage on top of the earlier bounded-capture fixes, but the narrowest reliable repro must use real child processes and wait for noisy writes to flush before asserting preserved tails.
- What changed: added two real subprocess-backed `createCodexAgentRunner()` regressions in `src/supervisor/agent-runner.test.ts` for a noisy non-zero Codex exit and a noisy timeout path. Tightened the existing high-output fixtures in `src/core/command.test.ts` to await stdout/stderr flushes before exit so bounded-capture assertions are deterministic under heavy output.
- Current blocker: none.
- Next exact step: commit the focused coverage changes on `codex/issue-1003`, push the branch, and open a draft PR if one does not already exist.
- Verification gap: none after `npx tsx --test src/core/command.test.ts src/cli/supervisor-runtime.test.ts src/supervisor/supervisor.test.ts src/supervisor/agent-runner.test.ts` and `npm run build`.
- Files touched: `src/core/command.test.ts`; `src/supervisor/agent-runner.test.ts`; `.codex-supervisor/issue-journal.md`.
- Rollback concern: low; changes are test-only plus journal state and do not alter subprocess execution behavior.
- Last focused command: `npm run build`
- Exact failure reproduced: the first subprocess-backed timeout/large-stderr runs exposed that high-output test fixtures which exit immediately after writing can drop their trailing suffix under pipe backpressure; the original `runCommand failure bounds large stderr...` test failed on `missing /stderr-suffix/`, and the first real timeout runner repro lost `timeout-suffix` until the child scripts awaited stderr flushes.
- Commands run: `sed -n '1,240p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-1003/AGENTS.generated.md`; `sed -n '1,240p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-1003/context-index.md`; `sed -n '1,320p' .codex-supervisor/issue-journal.md`; `git status --short --branch`; `git log --oneline --decorate -5`; `git diff --stat`; `git diff -- .codex-supervisor/issue-journal.md`; `git diff -- src/core/utils.ts src/local-ci.ts src/local-ci.test.ts src/supervisor/agent-runner.ts src/supervisor/agent-runner.test.ts src/supervisor/supervisor-failure-helpers.ts src/turn-execution-failure-helpers.ts src/turn-execution-failure-helpers.test.ts`; `sed -n '1,280p' src/core/command.ts`; `sed -n '1,280p' src/core/command.test.ts`; `sed -n '1,320p' src/cli/supervisor-runtime.ts`; `sed -n '1,320p' src/cli/supervisor-runtime.test.ts`; `sed -n '1,320p' src/supervisor/supervisor.test.ts`; `rg -n "runCommand\\(|CommandExecutionError|timeout|stderr|stdout|truncate|bounded|capture" src/cli src/supervisor src -g'*.ts'`; `sed -n '1,260p' src/supervisor/agent-runner.ts`; `sed -n '450,560p' src/supervisor/agent-runner.test.ts`; `sed -n '1,220p' src/local-ci.test.ts`; `sed -n '1,240p' src/local-ci.ts`; `sed -n '1,260p' src/turn-execution-failure-helpers.ts`; `sed -n '1,220p' src/turn-execution-failure-helpers.test.ts`; `sed -n '430,520p' src/supervisor/supervisor.ts`; `sed -n '1,240p' src/supervisor/index.ts`; `rg -n "runCommand\\(" src/supervisor src/doctor.ts src/local-ci.ts src/cli/supervisor-runtime.ts -g'*.ts'`; `rg -n "createSupervisorService|new Supervisor|class Supervisor" src/supervisor -g'*.ts'`; `rg -n "export async function runCodexTurn|function runCodexTurn|runCodexTurn\\(" src/codex -g'*.ts'`; `sed -n '1,280p' src/codex/index.ts`; `sed -n '1,320p' src/codex/codex-runner.ts`; `sed -n '1,280p' src/codex/codex-runner.test.ts`; `sed -n '1,220p' src/supervisor/agent-runner.test.ts`; `sed -n '220,520p' src/supervisor/agent-runner.test.ts`; `npx tsx --test src/supervisor/agent-runner.test.ts`; `npx tsx --test src/core/command.test.ts src/cli/supervisor-runtime.test.ts src/supervisor/supervisor.test.ts src/supervisor/agent-runner.test.ts`; `npx tsx -e '...'`; `test -d node_modules/typescript && echo installed || echo missing`; `test -f package-lock.json && echo lock-present || echo no-lock`; `npm ci`; `npm run build`; `date -u +"%Y-%m-%dT%H:%M:%SZ"`; `git rev-parse HEAD`.
- PR status: none yet.
### Scratchpad
- Leave `.codex-supervisor/replay/` untracked; it is local replay output, not part of the fix.
