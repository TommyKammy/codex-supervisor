# Issue #891: Execution metrics foundation: persist structured terminal run summaries

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/891
- Branch: codex/issue-891
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 2 (implementation=1, repair=1)
- Last head SHA: 6c1a2e0cdb67b54d2dcfeb4d8ec2212a19c1b288
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ852LxY6|PRRT_kwDORgvdZ852LxZF
- Repeated failure signature count: 1
- Updated at: 2026-03-23T16:44:34.511Z

## Latest Codex Summary
Persisted a write-only terminal run summary artifact at [src/supervisor/execution-metrics-run-summary.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-891/src/supervisor/execution-metrics-run-summary.ts). It writes `.codex-supervisor/execution-metrics/run-summary.json` with `issueNumber`, `terminalState`, `startedAt`, and `finishedAt`, and it’s wired into existing terminal-state save paths in [src/run-once-issue-preparation.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-891/src/run-once-issue-preparation.ts), [src/run-once-turn-execution.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-891/src/run-once-turn-execution.ts), [src/turn-execution-failure-helpers.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-891/src/turn-execution-failure-helpers.ts), [src/supervisor/supervisor-failure-helpers.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-891/src/supervisor/supervisor-failure-helpers.ts), and [src/supervisor/supervisor.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-891/src/supervisor/supervisor.ts) without changing scheduling or recovery behavior.

Added the focused reproducer in [src/supervisor/execution-metrics-run-summary.test.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-891/src/supervisor/execution-metrics-run-summary.test.ts) for `done`, `blocked`, and `failed` terminal outcomes. I also restored missing local dev dependencies in this worktree so `npm run build` could execute. Commit: `6c1a2e0` (`Add terminal execution run summaries`).

Summary: Added structured terminal run summary persistence and focused coverage for done/blocked/failed outcomes
State hint: implementing
Blocked reason: none
Tests: `npx tsx --test src/supervisor/execution-metrics-run-summary.test.ts`; `npm run build`
Failure signature: none
Next action: open or update the draft PR for `codex/issue-891` with commit `6c1a2e0`

## Active Failure Context
- Category: review
- Summary: 2 unresolved automated review thread(s) remain.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/904#discussion_r2976211150
- Details:
  - src/supervisor/supervisor-failure-helpers.ts:169 _⚠️ Potential issue_ | _🟡 Minor_ **Consider wrapping `syncExecutionMetricsRunSummary` in try/catch for observational writes.** The PR objectives state this artifact is "write-only and observational" and should not change execution behavior. However, if `syncExecutionMetricsRunSummary` throws (e.g., filesystem error), the exception will propagate and prevent `journalSync` from running. The `journalSync` call below (lines 171-178) has defensive error handling. For consistency with the observational nature of the metrics artifact, consider similar handling here. <details> <summary>🛡️ Proposed fix to add defensive error handling</summary> ```diff await stateStore.save(state); + try { await syncExecutionMetricsRunSummary({ previousRecord: record, nextRecord: updated, }); + } catch (metricsError) { + const metricsMessage = metricsError instanceof Error ? metricsError.message : String(metricsError); + console.warn( + `Failed to write execution metrics run summary for issue #${record.issue_number}: ${metricsMessage}`, + ); + } ``` </details> <!-- suggestion_start --> <details> <summary>📝 Committable suggestion</summary> > ‼️ **IMPORTANT** > Carefully review the code before committing. Ensure that it accurately replaces the highlighted code, contains no missing lines, and has no issues with indentation. Thoroughly test & benchmark the code to ensure it meets the requirements. ```suggestion try { await syncExecutionMetricsRunSummary({ previousRecord: record, nextRecord: updated, }); } catch (metricsError) { const metricsMessage = metricsError instanceof Error ? metricsError.message : String(metricsError); console.warn( `Failed to write execution metrics run summary for issue #${record.issue_number}: ${metricsMessage}`, ); } ``` </details> <!-- suggestion_end --> <details> <summary>🤖 Prompt for AI Agents</summary> ``` Verify each finding against the current code and only fix it if needed. In `@src/supervisor/supervisor-failure-helpers.ts` around lines 166 - 169, syncExecutionMetricsRunSummary is an observational, write-only artifact and must not block further cleanup if it fails; wrap the call to syncExecutionMetricsRunSummary({ previousRecord: record, nextRecord: updated }) in a try/catch and mirror the defensive handling used for journalSync — catch any error, log it with contextual information (including the error object) and do not rethrow so execution continues to the subsequent journalSync call. ``` </details> <!-- fingerprinting:phantom:poseidon:ocelot --> <!-- This is an auto-generated comment by CodeRabbit -->
  - src/turn-execution-failure-helpers.ts:127 _⚠️ Potential issue_ | _🟡 Minor_ **Same observational write concern applies here.** As noted in `supervisor-failure-helpers.ts`, the `syncExecutionMetricsRunSummary` call lacks defensive error handling. A filesystem failure would prevent `args.syncJournal(updated)` from executing on line 128. <details> <summary>🛡️ Proposed fix to add defensive error handling</summary> ```diff await args.stateStore.save(args.state); + try { await syncExecutionMetricsRunSummary({ previousRecord: args.record, nextRecord: updated, }); + } catch { + // Observational artifact write; failure should not block execution. + } await args.syncJournal(updated); ``` </details> <!-- suggestion_start --> <details> <summary>📝 Committable suggestion</summary> > ‼️ **IMPORTANT** > Carefully review the code before committing. Ensure that it accurately replaces the highlighted code, contains no missing lines, and has no issues with indentation. Thoroughly test & benchmark the code to ensure it meets the requirements. ```suggestion await args.stateStore.save(args.state); try { await syncExecutionMetricsRunSummary({ previousRecord: args.record, nextRecord: updated, }); } catch { // Observational artifact write; failure should not block execution. } await args.syncJournal(updated); ``` </details> <!-- suggestion_end --> <details> <summary>🤖 Prompt for AI Agents</summary> ``` Verify each finding against the current code and only fix it if needed. In `@src/turn-execution-failure-helpers.ts` around lines 124 - 127, The call to syncExecutionMetricsRunSummary can throw and currently would prevent args.syncJournal(updated) from running; wrap the await syncExecutionMetricsRunSummary({...}) call in a try/catch that catches any error, logs the error with context (including the updated record) and continues execution, ensuring args.syncJournal(updated) still runs (either in a finally block or after the catch); reference syncExecutionMetricsRunSummary and args.syncJournal so you add the defensive handling around that call and include the error details in the log. ``` </details> <!-- fingerprinting:phantom:poseidon:ocelot --> <!-- This is an auto-generated comment by CodeRabbit -->

## Codex Working Notes
### Current Handoff
- Hypothesis: the remaining review threads are valid because the new run-summary artifact is observational, so a filesystem write failure must not prevent later journal sync or other cleanup.
- What changed: wrapped `syncExecutionMetricsRunSummary` in defensive `try/catch` blocks in `src/supervisor/supervisor-failure-helpers.ts` and `src/turn-execution-failure-helpers.ts`, logging contextual metadata plus the original error object while allowing execution to continue to `journalSync`/`syncJournal`.
- Current blocker: none
- Next exact step: monitor PR #904 for any follow-up review or CI regressions after commit `ff0d5af` and the resolved CodeRabbit threads.
- Verification gap: none on the requested review-fix surface after focused helper regressions and a clean build.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/supervisor/supervisor-failure-helpers.ts`, `src/supervisor/supervisor-recovery-failure-flows.test.ts`, `src/turn-execution-failure-helpers.test.ts`, `src/turn-execution-failure-helpers.ts`
- Rollback concern: low; the change is write-only and observational, and reverting it would remove the terminal run summary artifact without affecting scheduling or PR flow.
- Last focused command: `gh api graphql -f query='mutation { first: resolveReviewThread(input: {threadId: "PRRT_kwDORgvdZ852LxY6"}) { thread { isResolved } } second: resolveReviewThread(input: {threadId: "PRRT_kwDORgvdZ852LxZF"}) { thread { isResolved } } }'`
- Last focused failure: first pass of the new helper regressions failed because `mock.method(...)` could not patch the re-exported `syncExecutionMetricsRunSummary` binding (`ERR_INVALID_ARG_VALUE`), so the tests were updated to inject the failure at `node:fs/promises.writeFile` instead.
- Last focused commands:
```bash
sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-891/AGENTS.generated.md
sed -n '1,260p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-891/context-index.md
sed -n '1,260p' .codex-supervisor/issue-journal.md
git status --short
sed -n '140,240p' src/supervisor/supervisor-failure-helpers.ts
sed -n '90,170p' src/turn-execution-failure-helpers.ts
rg -n "syncExecutionMetricsRunSummary|journalSync|syncJournal|console\\.warn" src/supervisor/supervisor-failure-helpers.ts src/turn-execution-failure-helpers.ts src/supervisor/execution-metrics-run-summary.test.ts
sed -n '260,560p' src/supervisor/execution-metrics-run-summary.test.ts
sed -n '1,120p' src/supervisor/execution-metrics-run-summary.test.ts
sed -n '1,120p' src/turn-execution-failure-helpers.ts
sed -n '1,140p' src/supervisor/supervisor-failure-helpers.ts
rg -n "mock\\.method|mock\\.fn|console\\.warn|throws.*syncExecutionMetricsRunSummary|persistCodexTurnExecutionFailure|recoverUnexpectedCodexTurnFailure" src/*.test.ts src/**/*.test.ts
rg --files src | rg 'turn-execution-failure-helpers|supervisor-recovery-failure-flows'
sed -n '1,280p' src/supervisor/supervisor-recovery-failure-flows.test.ts
sed -n '1,320p' src/turn-execution-failure-helpers.test.ts
sed -n '1,240p' src/supervisor/execution-metrics-run-summary.ts
apply_patch
npx tsx --test src/supervisor/execution-metrics-run-summary.test.ts src/turn-execution-failure-helpers.test.ts src/supervisor/supervisor-recovery-failure-flows.test.ts
npm run build
rg -n "export async function writeJsonAtomic|function writeJsonAtomic|writeJsonAtomic\\(" src/core/utils.ts
sed -n '1,260p' src/core/utils.ts
apply_patch
npx tsx --test src/supervisor/execution-metrics-run-summary.test.ts src/turn-execution-failure-helpers.test.ts src/supervisor/supervisor-recovery-failure-flows.test.ts
npm run build
date -u +%Y-%m-%dT%H:%M:%SZ
git add .codex-supervisor/issue-journal.md src/supervisor/supervisor-failure-helpers.ts src/supervisor/supervisor-recovery-failure-flows.test.ts src/turn-execution-failure-helpers.test.ts src/turn-execution-failure-helpers.ts
git commit -m "Handle observational run summary write failures"
git push origin codex/issue-891
gh api graphql -f query='mutation { first: resolveReviewThread(input: {threadId: "PRRT_kwDORgvdZ852LxY6"}) { thread { isResolved } } second: resolveReviewThread(input: {threadId: "PRRT_kwDORgvdZ852LxZF"}) { thread { isResolved } } }'
```
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
