# Issue #861: Stale recovery guard: preserve stale no-PR convergence tracking across successful no-PR turns

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/861
- Branch: codex/issue-861
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 2 (implementation=1, repair=1)
- Last head SHA: 79750459c67bf8164e02895aba660b7dca1de391
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ852AyNQ
- Repeated failure signature count: 1
- Updated at: 2026-03-23T01:12:01.258Z

## Latest Codex Summary
Implemented the stale no-PR guard fix in commit `7975045` and pushed `codex/issue-861`. The successful no-PR turn path now preserves `stale-stabilizing-no-pr-recovery-loop` only when the issue still ends `stabilizing` without a PR, so unrelated successful flows still clear generic failure tracking.

I added focused coverage for the regression in [`src/run-once-turn-execution.test.ts`](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-861/src/run-once-turn-execution.test.ts), a helper/unit check in [`src/no-pull-request-state.test.ts`](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-861/src/no-pull-request-state.test.ts), and an orchestration test for the full stale cleanup -> no-PR turn -> stale cleanup sequence in [`src/supervisor/supervisor-execution-orchestration.test.ts`](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-861/src/supervisor/supervisor-execution-orchestration.test.ts). Draft PR: https://github.com/TommyKammy/codex-supervisor/pull/866

Summary: Preserved stale stabilizing no-PR recovery tracking across successful no-PR turns, added focused regression coverage, pushed commit `7975045`, and opened draft PR #866.
State hint: waiting_ci
Blocked reason: none
Tests: `npx tsx --test src/run-once-turn-execution.test.ts src/supervisor/supervisor-recovery-reconciliation.test.ts src/supervisor/supervisor-execution-orchestration.test.ts` ; `npx tsx --test src/no-pull-request-state.test.ts src/run-once-turn-execution.test.ts src/supervisor/supervisor-recovery-reconciliation.test.ts`
Failure signature: none
Next action: Monitor PR #866 CI and address any failures or review feedback.

## Active Failure Context
- Category: review
- Summary: 1 unresolved automated review thread(s) remain.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/866#discussion_r2972402191
- Details:
  - src/run-once-turn-execution.ts:450 _⚠️ Potential issue_ | _🟡 Minor_ **`last_error` is not actually preserved in the stale no-PR success path.** Line 299 clears `last_error` on successful turns before this branch runs, so Lines 448-450 preserve `null` instead of the prior stale recovery message. <details> <summary>Proposed fix</summary> ```diff + const preTurnLastError = record.last_error; record = stateStore.touch(record, { codex_session_id: turnResult.sessionId, last_codex_summary: truncate(turnResult.supervisorMessage), last_failure_kind: turnResult.failureKind, last_error: turnResult.exitCode === 0 ? null : truncate([turnResult.stderr.trim(), turnResult.stdout.trim()].filter(Boolean).join("\n")), }); @@ last_error: preserveStaleNoPrRecoveryTracking - ? record.last_error + ? preTurnLastError : postRunState === "blocked" && postRunSnapshot?.failureContext ? truncate(postRunSnapshot.failureContext.summary, 1000) : record.last_error, ``` </details> <details> <summary>🤖 Prompt for AI Agents</summary> ``` Verify each finding against the current code and only fix it if needed. In `@src/run-once-turn-execution.ts` around lines 448 - 450, preserveStaleNoPrRecoveryTracking is using record.last_error here but last_error was cleared earlier on successful turns, so you need to capture the pre-clear error and use that instead; modify the code that clears last_error to store the value in a temporary (e.g., preRunLastError) before clearing, then change this branch to use preRunLastError when preserveStaleNoPrRecoveryTracking is true (falling back to postRunSnapshot?.failureContext or the existing logic when preRunLastError is undefined), referencing preserveStaleNoPrRecoveryTracking, record.last_error, postRunState, and postRunSnapshot.failureContext to locate where to plug the temporary value in. ``` </details> <!-- fingerprinting:phantom:poseidon:hawk --> <!-- This is an auto-generated comment by CodeRabbit -->

## Codex Working Notes
### Current Handoff
- Hypothesis: the remaining review issue was real, but the actual record reset happened in two places: the successful turn path nulled `last_error`, and workspace preparation had already cleared the stale no-PR recovery message before the turn started on the full `runOnce` path.
- What changed: captured `preTurnLastError` in `src/run-once-turn-execution.ts`, reused it when preserving stale no-PR recovery tracking after a successful no-PR turn, preserved `last_error` during `prepareIssueExecutionContext` when repeated no-PR failure tracking is intentionally retained, and extended the focused regressions in `src/run-once-issue-preparation.test.ts`, `src/run-once-turn-execution.test.ts`, and `src/supervisor/supervisor-execution-orchestration.test.ts`.
- Current blocker: none
- Next exact step: commit the review fix, push `codex/issue-861`, and update PR #866 so the remaining automated review thread can be re-evaluated.
- Verification gap: none in the focused review-fix surface; the direct execution, workspace preparation, and orchestration regressions all pass locally.
- Files touched: `src/run-once-issue-preparation.ts`, `src/run-once-issue-preparation.test.ts`, `src/run-once-turn-execution.ts`, `src/run-once-turn-execution.test.ts`, `src/supervisor/supervisor-execution-orchestration.test.ts`, `.codex-supervisor/issue-journal.md`
- Rollback concern: low; the behavior change is isolated to successful no-PR turns that remain in stale stabilizing recovery, while unrelated successful flows still clear generic failure signatures.
- Last focused command: `npx tsx --test src/run-once-issue-preparation.test.ts src/run-once-turn-execution.test.ts src/supervisor/supervisor-recovery-reconciliation.test.ts src/supervisor/supervisor-execution-orchestration.test.ts`
- Last focused failure: `PRRT_kwDORgvdZ852AyNQ`
- Last focused commands:
```bash
sed -n '1,220p' "<local-memory>/issue-861/AGENTS.generated.md"
sed -n '1,220p' "<local-memory>/issue-861/context-index.md"
sed -n '1,260p' .codex-supervisor/issue-journal.md
git status --short
sed -n '260,520p' src/run-once-turn-execution.ts
rg -n "preserveStaleNoPrRecoveryTracking|last_error|preTurnLastError|failureContext" src/run-once-turn-execution.ts
sed -n '820,1035p' src/run-once-turn-execution.test.ts
sed -n '340,500p' src/supervisor/supervisor-execution-orchestration.test.ts
rg -n "stale-stabilizing-no-pr-recovery-loop|last_error|repeated_failure_signature_count|last_failure_context|requeueIssueForOperator|stale_state_cleanup" src/recovery-reconciliation.ts src/supervisor -g '!**/*.test.ts'
sed -n '1080,1225p' src/recovery-reconciliation.ts
sed -n '1,260p' src/no-pull-request-state.ts
rg -n "previousError|prepareIssueExecutionContext|runPreparedIssue\\(|PreparedIssueExecutionContext|last_error: null" src/run-once-issue-preparation.ts src/supervisor/supervisor.ts src/run-once-turn-execution.ts
sed -n '1,220p' src/run-once-issue-preparation.ts
sed -n '520,700p' src/supervisor/supervisor.ts
rg -n "prepareWorkspaceContext|prepareIssueExecutionContext|previousError|last_error" src/run-once-issue-preparation.test.ts src -g 'src/*.test.ts'
sed -n '1,240p' src/run-once-issue-preparation.test.ts
npx tsx --test src/run-once-issue-preparation.test.ts src/run-once-turn-execution.test.ts src/supervisor/supervisor-recovery-reconciliation.test.ts src/supervisor/supervisor-execution-orchestration.test.ts
npx tsx --test src/no-pull-request-state.test.ts
git diff -- src/run-once-issue-preparation.ts src/run-once-issue-preparation.test.ts src/run-once-turn-execution.ts src/run-once-turn-execution.test.ts src/supervisor/supervisor-execution-orchestration.test.ts .codex-supervisor/issue-journal.md
date -u +%Y-%m-%dT%H:%M:%SZ
```
### Scratchpad
- 2026-03-23T01:15:00Z: verified the CodeRabbit `last_error` comment, fixed the post-turn preservation path in `executeCodexTurnPhase`, found the same stale no-PR message was also being cleared in `prepareIssueExecutionContext`, preserved it only when repeated no-PR failure tracking is intentionally retained, and passed `npx tsx --test src/run-once-issue-preparation.test.ts src/run-once-turn-execution.test.ts src/supervisor/supervisor-recovery-reconciliation.test.ts src/supervisor/supervisor-execution-orchestration.test.ts` plus `npx tsx --test src/no-pull-request-state.test.ts`.
- 2026-03-23T00:59:48Z: reproduced the bug with a focused `executeCodexTurnPhase` regression showing a successful no-PR turn cleared `stale-stabilizing-no-pr-recovery-loop`, then fixed the post-turn no-PR success path to preserve only that stale stabilizing signature/context/count when the issue still ends `stabilizing` without a PR and verified the full stale cleanup -> no-PR turn -> stale cleanup sequence with the targeted orchestration suite.
- 2026-03-23T00:29:58Z: confirmed the remaining CodeRabbit finding is valid because the durable journal still contained workstation-local absolute paths, then rewrote the summary/review context/command history locally to use repo-relative references and `<local-memory>` placeholders before preparing the review-only push.
- 2026-03-22T22:21:32Z: reran `npx tsx --test src/backend/webui-dashboard-browser-logic.test.ts src/backend/webui-dashboard.test.ts`, pushed `codex/issue-848`, and opened draft PR `#858` for the drag-reorder checkpoint.
- 2026-03-22T22:09:23Z: reproduced the drag-reorder gap with a pure browser-logic regression, then added draggable panel handles, browser-only DOM reorder state, and a runtime dashboard drag test; `npx tsx --test src/backend/webui-dashboard-browser-logic.test.ts src/backend/webui-dashboard.test.ts` passed.
- 2026-03-22T21:40:05Z: pushed `codex/issue-847` and opened draft PR `#857` for the verified dashboard refresh checkpoint.
- 2026-03-22T21:40:05Z: reproduced the visual-refresh gap with a new hero-and-section framing regression, refreshed the dashboard page chrome/CSS to add labeled lanes and flatter surfaces, and passed `npx tsx --test src/backend/webui-dashboard.test.ts src/backend/webui-dashboard-browser-logic.test.ts`.
- 2026-03-22T21:15:08Z: pushed `codex/issue-846` and opened draft PR `#856`; GitHub currently reports `mergeStateStatus=UNSTABLE`, so the next turn should inspect CI/check runs and address any failures or review feedback.
- 2026-03-22T21:14:15Z: confirmed there was no existing PR for `codex/issue-846`; next step is to push the branch and open a draft PR with commit `c4e2a04`.
- 2026-03-22T21:02:11Z: reproduced the issue with a new shell-structure regression, then passed the focused verification command after moving all dashboard panels onto a shared shell helper with a reserved drag slot and shared subtitle/meta/action lanes.
- 2026-03-22T20:06:27Z: committed the typed dashboard panel layout work as `a6f6ea0`, pushed `codex/issue-845`, and opened draft PR `#855` at https://github.com/TommyKammy/codex-supervisor/pull/855.
- 2026-03-22T20:04:56Z: added typed dashboard panel ids, registry, default layout state, and normalization in `src/backend/webui-dashboard-panel-layout.ts`, then switched `src/backend/webui-dashboard-page.ts` to render from the registry so DOM order is driven by typed layout data rather than duplicated markup order.
- 2026-03-22T20:04:56Z: added focused regressions in `src/backend/webui-dashboard-browser-logic.test.ts` and `src/backend/webui-dashboard.test.ts`; `npx tsx --test src/backend/webui-dashboard-browser-logic.test.ts src/backend/webui-dashboard.test.ts` passed twice on the local diff.
