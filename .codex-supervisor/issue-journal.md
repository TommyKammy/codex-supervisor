# Issue #1002: Subprocess error hygiene follow-up: preserve actionable timeout and failure summaries under bounded capture

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1002
- Branch: codex/issue-1002
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: waiting_ci
- Attempt count: 3 (implementation=1, repair=2)
- Last head SHA: 259f7cb22e5a9233d9a3c84901373cacb785a8b4
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-25T15:23:27Z

## Latest Codex Summary
Addressed the remaining automated review thread by updating the issue journal's `PR status` line to reflect open PR `#1021`, committed the review fix as `259f7cb`, pushed `codex/issue-1002`, and resolved thread `PRRT_kwDORgvdZ852wNP-` on GitHub.

The underlying subprocess-summary fix remains the same: `truncatePreservingStartAndEnd()` in [utils.ts](src/core/utils.ts) keeps actionable timeout/failure tails visible in downstream summaries, with focused regressions in [local-ci.test.ts](src/local-ci.test.ts), [agent-runner.test.ts](src/supervisor/agent-runner.test.ts), and [turn-execution-failure-helpers.test.ts](src/turn-execution-failure-helpers.test.ts). PR #1021 is open: https://github.com/TommyKammy/codex-supervisor/pull/1021

Summary: Updated the issue journal to reflect live PR #1021 status, pushed commit `259f7cb`, and resolved the last automated review thread for issue #1002.
State hint: waiting_ci
Blocked reason: none
Tests: `git diff --check -- .codex-supervisor/issue-journal.md`
Next action: Monitor PR #1021 CI and address any review or test failures that come back.
Failure signature: none

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: bounded `runCommand()` capture now preserves both ends, but several downstream summaries still applied head-only `truncate(...)`, so noisy stderr could drop the tail where timeout and final failure lines live.
- What changed: added `truncatePreservingStartAndEnd()` in `src/core/utils.ts` and switched operator-facing failure summaries in `src/local-ci.ts`, `src/supervisor/agent-runner.ts`, `src/supervisor/supervisor-failure-helpers.ts`, and `src/turn-execution-failure-helpers.ts` to use it. Added focused regressions in `src/local-ci.test.ts`, `src/supervisor/agent-runner.test.ts`, and `src/turn-execution-failure-helpers.test.ts` to prove timeout summaries remain visible with explicit `\n...\n` truncation markers.
- Current blocker: none.
- Next exact step: monitor PR `#1021` for any follow-up CI or review activity after the pushed journal-only repair.
- Verification gap: none for this turn's journal-only review repair; no code-path changes were made after the prior passing test/build run.
- Files touched: `src/core/utils.ts`; `src/local-ci.ts`; `src/local-ci.test.ts`; `src/supervisor/agent-runner.ts`; `src/supervisor/agent-runner.test.ts`; `src/supervisor/supervisor-failure-helpers.ts`; `src/turn-execution-failure-helpers.ts`; `src/turn-execution-failure-helpers.test.ts`; `.codex-supervisor/issue-journal.md`.
- Rollback concern: low; changes stay in summary-rendering paths and focused regression coverage without changing subprocess execution semantics.
- Last focused command: `gh api graphql -f query='mutation($threadId:ID!){ resolveReviewThread(input:{threadId:$threadId}) { thread { isResolved } } }' -F threadId=PRRT_kwDORgvdZ852wNP-`
- Exact failure reproduced: before the fix, a long bounded stderr still lost its trailing timeout line after a second head-only truncation in shared summaries; an ad hoc `createCodexAgentRunner()` repro printed `HAS_TIMEOUT false` even though the stderr ended with `Command timed out after 1800000ms: codex exec`.
- Commands run: `sed -n '1,240p' <redacted-local-path>`; `sed -n '1,240p' <redacted-local-path>`; `sed -n '1,320p' .codex-supervisor/issue-journal.md`; `git status --short --branch`; `sed -n '1,260p' src/core/command.ts`; `sed -n '1,260p' src/core/command.test.ts`; `sed -n '1,260p' src/cli/supervisor-runtime.test.ts`; `sed -n '1,260p' src/doctor.test.ts`; `rg -n "timed out|timeout|stderr|stdout|truncat|bounded|CommandExecutionError|runCommand\\(" src -g'*.ts'`; `sed -n '1,240p' src/local-ci.ts`; `sed -n '1,280p' src/supervisor/agent-runner.ts`; `sed -n '1,320p' src/doctor.ts`; `sed -n '1,260p' src/cli/supervisor-runtime.ts`; `sed -n '1,260p' src/core/utils.ts`; `sed -n '1,220p' src/local-ci.test.ts`; `sed -n '1,240p' src/supervisor/supervisor-failure-helpers.ts`; `git log --oneline --decorate -5`; `sed -n '380,460p' src/doctor.test.ts`; `sed -n '1,220p' src/build.test.ts`; `sed -n '1,220p' src/local-review/runner.ts`; `sed -n '1,220p' src/supervisor/supervisor-execution-orchestration.test.ts`; `sed -n '430,520p' src/supervisor/agent-runner.test.ts`; `sed -n '1,220p' src/supervisor/agent-runner.test.ts`; `npx tsx -e '...'`; `sed -n '1,280p' src/turn-execution-failure-helpers.ts`; `sed -n '1,260p' src/supervisor/supervisor-recovery-failure-flows.test.ts`; `sed -n '1,220p' src/turn-execution-failure-helpers.test.ts`; `npx tsx --test src/local-ci.test.ts`; `npx tsx --test src/supervisor/agent-runner.test.ts`; `npx tsx --test src/turn-execution-failure-helpers.test.ts`; `npx tsx --test src/core/command.test.ts src/cli/supervisor-runtime.test.ts src/doctor.test.ts src/local-ci.test.ts src/supervisor/agent-runner.test.ts src/turn-execution-failure-helpers.test.ts`; `npm run build`; `test -d node_modules/typescript && echo installed || echo missing`; `test -f package-lock.json && echo lock-present || echo no-lock`; `npm ci`; `npm run build`; `git diff -- src/core/utils.ts src/local-ci.ts src/local-ci.test.ts src/supervisor/agent-runner.ts src/supervisor/agent-runner.test.ts src/supervisor/supervisor-failure-helpers.ts src/turn-execution-failure-helpers.ts src/turn-execution-failure-helpers.test.ts .codex-supervisor/issue-journal.md`; `date -u +"%Y-%m-%dT%H:%M:%SZ"`; `git rev-parse HEAD`; `git diff -- .codex-supervisor/issue-journal.md`; `git diff --check -- .codex-supervisor/issue-journal.md`; `sed -n '38,70p' .codex-supervisor/issue-journal.md`; `git add .codex-supervisor/issue-journal.md`; `git commit -m "docs: update issue 1002 journal review status"`; `git push origin codex/issue-1002`; `gh api graphql -f query='mutation($threadId:ID!){ resolveReviewThread(input:{threadId:$threadId}) { thread { isResolved } } }' -F threadId=PRRT_kwDORgvdZ852wNP-`; `git status --short --branch`; `sed -n '1,120p' .codex-supervisor/issue-journal.md`; `git rev-parse HEAD`; `date -u +"%Y-%m-%dT%H:%M:%SZ"`.
- PR status: PR `#1021` open; branch updated with commit `259f7cb` at 2026-03-25T15:23:27Z.
### Scratchpad
- Leave `.codex-supervisor/replay/` untracked; it is local replay output, not part of the fix.
