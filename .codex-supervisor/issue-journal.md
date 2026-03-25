# Issue #1002: Subprocess error hygiene follow-up: preserve actionable timeout and failure summaries under bounded capture

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1002
- Branch: codex/issue-1002
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 2 (implementation=1, repair=1)
- Last head SHA: 5d194bf3961ab12985fff8429a83b92ad4a64fc5
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ852wNP-
- Repeated failure signature count: 1
- Updated at: 2026-03-25T15:22:19.498Z

## Latest Codex Summary
Preserved actionable timeout/failure tails after bounded subprocess capture by adding `truncatePreservingStartAndEnd()` in [utils.ts](src/core/utils.ts) and switching the downstream operator-facing summary paths in [local-ci.ts](src/local-ci.ts), [agent-runner.ts](src/supervisor/agent-runner.ts), [supervisor-failure-helpers.ts](src/supervisor/supervisor-failure-helpers.ts), and [turn-execution-failure-helpers.ts](src/turn-execution-failure-helpers.ts). The focused regressions are in [local-ci.test.ts](src/local-ci.test.ts), [agent-runner.test.ts](src/supervisor/agent-runner.test.ts), and [turn-execution-failure-helpers.test.ts](src/turn-execution-failure-helpers.test.ts).

I reproduced the bug first with an ad hoc `createCodexAgentRunner()` repro where a noisy stderr ended with `Command timed out after 1800000ms: codex exec` but the shared failure detail dropped that tail after a second truncation. The fix is committed as `5d194bf` on `codex/issue-1002`, and draft PR #1021 is open: https://github.com/TommyKammy/codex-supervisor/pull/1021

Summary: Preserved actionable timeout/failure tails in bounded subprocess summaries, added focused regressions, committed the fix, and opened draft PR #1021.
State hint: waiting_ci
Blocked reason: none
Tests: `npm ci`; `npx tsx --test src/local-ci.test.ts`; `npx tsx --test src/supervisor/agent-runner.test.ts`; `npx tsx --test src/turn-execution-failure-helpers.test.ts`; `npx tsx --test src/core/command.test.ts src/cli/supervisor-runtime.test.ts src/doctor.test.ts src/local-ci.test.ts src/supervisor/agent-runner.test.ts src/turn-execution-failure-helpers.test.ts`; `npm run build`
Next action: Monitor PR #1021 CI and address any review or test failures that come back.
Failure signature: PRRT_kwDORgvdZ852wNP-

## Active Failure Context
- Category: review
- Summary: 1 unresolved automated review thread(s) remain.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/1021#discussion_r2988995992
- Details:
  - .codex-supervisor/issue-journal.md:34 _⚠️ Potential issue_ | _🟡 Minor_ **Update the PR status to reflect PR `#1021`.** The journal states no PR exists yet, but this file is being committed in PR `#1021` (opened at 2026-03-25T15:15:27Z for issue `#1002`). Update the status for accurate tracking. <details> <summary>📝 Suggested fix</summary> ```diff -- PR status: none yet for issue `#1002`. +- PR status: PR `#1021` opened at 2026-03-25T15:15:27Z for issue `#1002`. ``` </details> <!-- suggestion_start --> <details> <summary>📝 Committable suggestion</summary> > ‼️ **IMPORTANT** > Carefully review the code before committing. Ensure that it accurately replaces the highlighted code, contains no missing lines, and has no issues with indentation. Thoroughly test & benchmark the code to ensure it meets the requirements. ```suggestion - PR status: PR `#1021` opened at 2026-03-25T15:15:27Z for issue `#1002`. ``` </details> <!-- suggestion_end --> <details> <summary>🤖 Prompt for AI Agents</summary> ``` Verify each finding against the current code and only fix it if needed. In @.codex-supervisor/issue-journal.md at line 34, Update the journal entry line that currently reads "PR status: none yet for issue `#1002`." to reflect that PR `#1021` has been opened for issue `#1002` (opened at 2026-03-25T15:15:27Z). Replace the existing "PR status" sentence with a concise status indicating PR `#1021` is open and include the PR number and timestamp (or at minimum "PR `#1021` opened 2026-03-25T15:15:27Z") so the entry accurately tracks the current PR state. ``` </details> <!-- fingerprinting:phantom:triton:puma --> <!-- This is an auto-generated comment by CodeRabbit -->

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
- Commands run: `sed -n '1,240p' <redacted-local-path>`; `sed -n '1,240p' <redacted-local-path>`; `sed -n '1,320p' .codex-supervisor/issue-journal.md`; `git status --short --branch`; `sed -n '1,260p' src/core/command.ts`; `sed -n '1,260p' src/core/command.test.ts`; `sed -n '1,260p' src/cli/supervisor-runtime.test.ts`; `sed -n '1,260p' src/doctor.test.ts`; `rg -n "timed out|timeout|stderr|stdout|truncat|bounded|CommandExecutionError|runCommand\\(" src -g'*.ts'`; `sed -n '1,240p' src/local-ci.ts`; `sed -n '1,280p' src/supervisor/agent-runner.ts`; `sed -n '1,320p' src/doctor.ts`; `sed -n '1,260p' src/cli/supervisor-runtime.ts`; `sed -n '1,260p' src/core/utils.ts`; `sed -n '1,220p' src/local-ci.test.ts`; `sed -n '1,240p' src/supervisor/supervisor-failure-helpers.ts`; `git log --oneline --decorate -5`; `sed -n '380,460p' src/doctor.test.ts`; `sed -n '1,220p' src/build.test.ts`; `sed -n '1,220p' src/local-review/runner.ts`; `sed -n '1,220p' src/supervisor/supervisor-execution-orchestration.test.ts`; `sed -n '430,520p' src/supervisor/agent-runner.test.ts`; `sed -n '1,220p' src/supervisor/agent-runner.test.ts`; `npx tsx -e '...'`; `sed -n '1,280p' src/turn-execution-failure-helpers.ts`; `sed -n '1,260p' src/supervisor/supervisor-recovery-failure-flows.test.ts`; `sed -n '1,220p' src/turn-execution-failure-helpers.test.ts`; `npx tsx --test src/local-ci.test.ts`; `npx tsx --test src/supervisor/agent-runner.test.ts`; `npx tsx --test src/turn-execution-failure-helpers.test.ts`; `npx tsx --test src/core/command.test.ts src/cli/supervisor-runtime.test.ts src/doctor.test.ts src/local-ci.test.ts src/supervisor/agent-runner.test.ts src/turn-execution-failure-helpers.test.ts`; `npm run build`; `test -d node_modules/typescript && echo installed || echo missing`; `test -f package-lock.json && echo lock-present || echo no-lock`; `npm ci`; `npm run build`; `git diff -- src/core/utils.ts src/local-ci.ts src/local-ci.test.ts src/supervisor/agent-runner.ts src/supervisor/agent-runner.test.ts src/supervisor/supervisor-failure-helpers.ts src/turn-execution-failure-helpers.ts src/turn-execution-failure-helpers.test.ts .codex-supervisor/issue-journal.md`; `date -u +"%Y-%m-%dT%H:%M:%SZ"`; `git rev-parse HEAD`.
- PR status: PR `#1021` opened at 2026-03-25T15:15:27Z for issue `#1002`.
### Scratchpad
- Leave `.codex-supervisor/replay/` untracked; it is local replay output, not part of the fix.
