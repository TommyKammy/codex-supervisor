# Issue #862: Stale recovery counter: add dedicated repetition tracking for stale stabilizing no-PR cleanup

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/862
- Branch: codex/issue-862
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 2 (implementation=1, repair=1)
- Last head SHA: 187c4c6e6b5eb58af305d0e9f2c27445cf305c75
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ852A-pm
- Repeated failure signature count: 1
- Updated at: 2026-03-23T01:54:56.185Z

## Latest Codex Summary
Implemented a dedicated `stale_stabilizing_no_pr_recovery_count` that survives successful no-PR turns and drives stale stabilizing recovery repetition independently from `repeated_failure_signature_count`. The stale recovery reconciliation path now increments/resets that dedicated counter, the no-PR lifecycle preserves stale recovery context without preserving the generic failure count, and focused regressions cover persistence, increment-at-requeue, and reset-on-PR-recovery behavior.

Committed as `187c4c6` (`Add stale no-PR recovery repetition counter`), pushed `codex/issue-862`, and opened draft PR [#867](https://github.com/TommyKammy/codex-supervisor/pull/867). Local worktree is clean except for the pre-existing untracked `.codex-supervisor/replay/`.

Summary: Added dedicated stale stabilizing no-PR recovery repetition tracking, verified the focused stale recovery paths locally, and opened draft PR #867.
State hint: draft_pr
Blocked reason: none
Tests: `npx tsx --test src/supervisor/supervisor-recovery-reconciliation.test.ts src/run-once-turn-execution.test.ts src/supervisor/supervisor-lifecycle.test.ts src/no-pull-request-state.test.ts`
Failure signature: none
Next action: Monitor draft PR #867 and address CI or review feedback if it appears.

## Active Failure Context
- Category: review
- Summary: 1 unresolved automated review thread(s) remain.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/867#discussion_r2972470020
- Details:
  - src/no-pull-request-state.ts:17 _⚠️ Potential issue_ | _🟠 Major_ **Scope the dedicated stale counter to the stale signature before returning it.** On Line 11, the helper returns `stale_stabilizing_no_pr_recovery_count` even when `last_failure_signature` is not stale. Since Line 34 consumes this helper, stale-specific budget can leak into unrelated no-PR failure tracking. <details> <summary>Suggested fix</summary> ```diff export function getStaleStabilizingNoPrRecoveryCount( record: Pick< IssueRunRecord, "last_failure_signature" | "repeated_failure_signature_count" | "stale_stabilizing_no_pr_recovery_count" >, ): number { - if ((record.stale_stabilizing_no_pr_recovery_count ?? 0) > 0) { - return record.stale_stabilizing_no_pr_recovery_count ?? 0; + if (record.last_failure_signature !== STALE_STABILIZING_NO_PR_RECOVERY_SIGNATURE) { + return 0; } - return record.last_failure_signature === STALE_STABILIZING_NO_PR_RECOVERY_SIGNATURE - ? record.repeated_failure_signature_count - : 0; + if ((record.stale_stabilizing_no_pr_recovery_count ?? 0) > 0) { + return record.stale_stabilizing_no_pr_recovery_count ?? 0; + } + + return record.repeated_failure_signature_count; } ``` </details> <details> <summary>🤖 Prompt for AI Agents</summary> ``` Verify each finding against the current code and only fix it if needed. In `@src/no-pull-request-state.ts` around lines 5 - 17, The helper getStaleStabilizingNoPrRecoveryCount currently returns stale_stabilizing_no_pr_recovery_count regardless of the last_failure_signature, allowing stale-specific budget to leak; change the logic so the dedicated counter is only returned when last_failure_signature === STALE_STABILIZING_NO_PR_RECOVERY_SIGNATURE (i.e., check both record.stale_stabilizing_no_pr_recovery_count > 0 AND record.last_failure_signature === STALE_STABILIZING_NO_PR_RECOVERY_SIGNATURE before returning it), otherwise fall back to returning record.repeated_failure_signature_count when the signature is stale, or 0 when it is not. ``` </details> <!-- fingerprinting:phantom:poseidon:hawk --> <!-- This is an auto-generated comment by CodeRabbit -->

## Codex Working Notes
### Current Handoff
- Hypothesis: the dedicated stale no-PR recovery counter remained correct for stale loops, but `getStaleStabilizingNoPrRecoveryCount` still surfaced that counter for unrelated `last_failure_signature` values, letting stale-only retry budget leak into generic no-PR failure preservation.
- What changed: scoped `getStaleStabilizingNoPrRecoveryCount` to `STALE_STABILIZING_NO_PR_RECOVERY_SIGNATURE` before returning either the dedicated counter or the migration fallback count, and added a regression in `src/no-pull-request-state.test.ts` proving unrelated no-PR failures do not preserve tracking from `stale_stabilizing_no_pr_recovery_count`.
- Current blocker: none
- Next exact step: commit and push the review fix on `codex/issue-862`, then resolve the outstanding PR review thread if GitHub accepts the updated head.
- Verification gap: none in the focused stale no-PR recovery surface; helper, lifecycle, turn execution, and reconciliation coverage all pass locally after the review fix.
- Files touched: `src/no-pull-request-state.ts`, `src/no-pull-request-state.test.ts`, `.codex-supervisor/issue-journal.md`
- Rollback concern: low; the new counter is narrowly scoped to stale stabilizing no-PR recovery and falls back to the previous generic repeat count only for migration/older state compatibility.
- Last focused command: `npx tsx --test src/supervisor/supervisor-recovery-reconciliation.test.ts src/run-once-turn-execution.test.ts src/supervisor/supervisor-lifecycle.test.ts src/no-pull-request-state.test.ts`
- Last focused failure: `PRRT_kwDORgvdZ852A-pm`
- Last focused commands:
```bash
sed -n '1,220p' "<local-memory>/issue-862/AGENTS.generated.md"
sed -n '1,220p' "<local-memory>/issue-862/context-index.md"
sed -n '1,260p' .codex-supervisor/issue-journal.md
git status --short
sed -n '1,260p' src/no-pull-request-state.ts
sed -n '1,240p' src/no-pull-request-state.test.ts
apply_patch
npx tsx --test src/supervisor/supervisor-recovery-reconciliation.test.ts src/run-once-turn-execution.test.ts src/supervisor/supervisor-lifecycle.test.ts src/no-pull-request-state.test.ts
git diff -- src/no-pull-request-state.ts src/no-pull-request-state.test.ts
git diff -- .codex-supervisor/issue-journal.md
date -u +%Y-%m-%dT%H:%M:%SZ
```
### Scratchpad
- 2026-03-23T01:55:57Z: validated CodeRabbit thread `PRRT_kwDORgvdZ852A-pm` against the live branch, confirmed `getStaleStabilizingNoPrRecoveryCount` leaked `stale_stabilizing_no_pr_recovery_count` across unrelated failure signatures, then scoped the helper to the stale signature and passed `npx tsx --test src/no-pull-request-state.test.ts src/run-once-turn-execution.test.ts src/supervisor/supervisor-lifecycle.test.ts src/supervisor/supervisor-recovery-reconciliation.test.ts`.
- 2026-03-22T21:40:05Z: pushed `codex/issue-847` and opened draft PR `#857` for the verified dashboard refresh checkpoint.
- 2026-03-22T21:40:05Z: reproduced the visual-refresh gap with a new hero-and-section framing regression, refreshed the dashboard page chrome/CSS to add labeled lanes and flatter surfaces, and passed `npx tsx --test src/backend/webui-dashboard.test.ts src/backend/webui-dashboard-browser-logic.test.ts`.
- 2026-03-22T21:15:08Z: pushed `codex/issue-846` and opened draft PR `#856`; GitHub currently reports `mergeStateStatus=UNSTABLE`, so the next turn should inspect CI/check runs and address any failures or review feedback.
- 2026-03-22T21:14:15Z: confirmed there was no existing PR for `codex/issue-846`; next step is to push the branch and open a draft PR with commit `c4e2a04`.
- 2026-03-22T21:02:11Z: reproduced the issue with a new shell-structure regression, then passed the focused verification command after moving all dashboard panels onto a shared shell helper with a reserved drag slot and shared subtitle/meta/action lanes.
- 2026-03-22T20:06:27Z: committed the typed dashboard panel layout work as `a6f6ea0`, pushed `codex/issue-845`, and opened draft PR `#855` at https://github.com/TommyKammy/codex-supervisor/pull/855.
- 2026-03-22T20:04:56Z: added typed dashboard panel ids, registry, default layout state, and normalization in `src/backend/webui-dashboard-panel-layout.ts`, then switched `src/backend/webui-dashboard-page.ts` to render from the registry so DOM order is driven by typed layout data rather than duplicated markup order.
- 2026-03-22T20:04:56Z: added focused regressions in `src/backend/webui-dashboard-browser-logic.test.ts` and `src/backend/webui-dashboard.test.ts`; `npx tsx --test src/backend/webui-dashboard-browser-logic.test.ts src/backend/webui-dashboard.test.ts` passed twice on the local diff.
