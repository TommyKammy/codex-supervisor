# Issue #554: Recovery visibility: reuse recorded recovery reasons in explain diagnostics

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/554
- Branch: codex/issue-554
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 2aee74ceb319c2dc23b4690a9d80d80073571dc8
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-18T15:32:14.651Z

## Latest Codex Summary
- None yet.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: `explain` already knew when a tracked issue was in a resumed lifecycle state, but it only surfaced generic selection text like `retry_state=resume:reproducing` and never reused the persisted `last_recovery_reason` / `last_recovery_at` story that status already formats.
- What changed: added a focused explain regression for a recovered tracked PR issue in `reproducing`, then updated `buildIssueExplainSummary(...)` to reuse `formatLatestRecoveryStatusLine(...)` so explain emits the same compact `latest_recovery ... reason=<code> detail=<stored explanation>` line as status.
- Current blocker: none
- Next exact step: commit the explain recovery diagnostic change on `codex/issue-554`, then open or update the draft PR for issue #554.
- Verification gap: broader full-suite verification has not been run.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/supervisor/supervisor-diagnostics-explain.test.ts`, `src/supervisor/supervisor-selection-status.ts`
- Rollback concern: removing the shared recovery formatter from explain would drop the canonical persisted recovery story and regress resumed tracked-PR explanations back to generic lifecycle text.
- Last focused command: `npx tsx --test src/supervisor/supervisor-diagnostics-explain.test.ts src/supervisor/supervisor-recovery-reconciliation.test.ts`; `npm install`; `npm run build`
### Scratchpad
- 2026-03-19 (JST): Added a focused repro in `src/supervisor/supervisor-diagnostics-explain.test.ts` for a tracked PR issue resumed into `reproducing`; the initial failure was missing `latest_recovery ...` output and only showed `selection_reason=... retry_state=resume:reproducing`. Reused `formatLatestRecoveryStatusLine(...)` in `src/supervisor/supervisor-selection-status.ts`, reran the focused explain + recovery tests, restored local dependencies with `npm install`, and reran `npm run build` successfully.
- 2026-03-19 (JST): Pushed `codex/issue-553` and opened draft PR #570 for the compact latest-recovery status rendering change.
- 2026-03-19 (JST): Added a focused repro in `src/supervisor/supervisor-status-rendering.test.ts` for an active recovered record whose `last_recovery_reason` was rendered as a raw `tracked_pr_head_advanced: ...` string; implemented compact `reason=` / `detail=` status rendering via `formatLatestRecoveryStatusLine(...)`; reran focused status + recovery tests and `npm run build` after restoring local dependencies with `npm install`.
- 2026-03-18 (JST): Reran the focused recovery/lifecycle tests and `npm run build`, pushed `codex/issue-552`, and opened draft PR #569.
- 2026-03-18 (JST): Added a narrow repro in `src/supervisor/supervisor-recovery-reconciliation.test.ts` for a failed record with `repeated_failure_signature_count=3` that resumes after tracked PR `#191` advances from `head-old-191` to `head-new-191`; the initial focused failure was `last_recovery_reason === null`.
- 2026-03-18 (JST): Implemented deterministic tracked-PR resume recovery reasons in `src/recovery-reconciliation.ts`, distinguishing head-advance resumptions from same-head fresh-facts resumptions, and persisted them with `applyRecoveryEvent(...)`.
- 2026-03-18 (JST): `npm run build` initially failed with `sh: 1: tsc: not found`; ran `npm install` to restore the local toolchain, then reran focused tests and the build successfully.
