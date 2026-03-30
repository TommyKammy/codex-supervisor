# Issue #1207: [codex] Classify local CI gate failures and route remediation guidance

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1207
- Branch: codex/issue-1207
- Workspace: .
- Journal: .codex-supervisor/issues/1207/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: d854b7d62f525e548c221a5031f514095846e189
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-30T13:12:35.853Z

## Latest Codex Summary
- Added typed local CI outcome classification and remediation routing for unset-contract, missing-command, and non-zero-exit cases. Focused and issue-target verification passed; `npm run build` is still blocked in this workspace because `tsc` is not installed locally.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: local CI gate failures were all collapsing into one generic blocked diagnostic, so operator-facing status needed typed classification plus remediation targeting without changing fail-closed behavior.
- What changed: extended `LatestLocalCiResult` with typed `failure_class` and `remediation_target`; `runLocalCiGate` now reports `unset_contract` as a non-blocking status result, classifies missing configured commands as `missing_command`, classifies runnable failures as `non_zero_exit`, emits class-specific summaries/signatures, and threads those fields into supervisor activity-context diagnostics. Updated focused regression tests and signature expectations.
- Current blocker: `npm run build` fails in the workspace because `tsc` is unavailable (`sh: 1: tsc: not found`) and `npx tsc` also fails because `typescript` is not installed locally.
- Next exact step: install project dev dependencies in the workspace, rerun `npm run build`, then decide whether to widen rendered-status assertions or open/update a draft PR.
- Verification gap: build verification is incomplete due missing local TypeScript dependency; `src/supervisor/supervisor-selection-issue-explain.test.ts` still has unrelated baseline failures outside the issue verification set.
- Files touched: src/core/types.ts; src/local-ci.ts; src/local-ci.test.ts; src/supervisor/supervisor-operator-activity-context.ts; src/post-turn-pull-request.test.ts; src/run-once-turn-execution.test.ts; src/turn-execution-publication-gate.test.ts; src/supervisor/supervisor-cycle-snapshot.test.ts; src/supervisor/supervisor-diagnostics-status-selection.test.ts; src/supervisor/supervisor-selection-issue-explain.test.ts; src/supervisor/supervisor-execution-orchestration.test.ts; src/supervisor/supervisor-recovery-failure-flows.test.ts
- Rollback concern: low to medium; the gate now persists a non-blocking `latest_local_ci_result` when `localCiCommand` is unset, so downstream consumers that implicitly treated null as “never ran” should be monitored.
- Last focused command: npx tsx --test src/doctor.test.ts src/backend/webui-dashboard.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
