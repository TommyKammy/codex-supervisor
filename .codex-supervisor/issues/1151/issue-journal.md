# Issue #1151: Expose GitHub-versus-local tracked PR mismatches in doctor status and explain

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1151
- Branch: codex/issue-1151
- Workspace: .
- Journal: .codex-supervisor/issues/1151/issue-journal.md
- Current phase: stabilizing
- Attempt count: 2 (implementation=2, repair=0)
- Last head SHA: 3eff5f1bc72dc4d30294ec1c602abeee8aaeedc7
- Blocked reason: none
- Last failure signature: stale-stabilizing-no-pr-recovery-loop
- Repeated failure signature count: 0
- Updated at: 2026-03-28T06:48:44.885Z

## Latest Codex Summary
Summary: Restored local TypeScript tooling with `npm ci`, fixed stale `SupervisorExplainDto` test fixtures for the new mismatch fields, and revalidated the tracked-PR mismatch change with a clean build plus focused HTTP/doctor/status/explain coverage.
State hint: draft_pr
Blocked reason: none
Tests: `npm ci`; `npm run build`; `npm test` (fails in unrelated baseline tests outside this issue); `npx tsx --test src/backend/supervisor-http-server.test.ts`; `npx tsx --test src/supervisor/supervisor-diagnostics-explain.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts src/doctor.test.ts`
Next action: monitor draft PR `#1161` and decide whether to chase any out-of-scope baseline `npm test` failures separately from this issue
Failure signature: none

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: Operator diagnostics need a shared tracked-PR comparison against live GitHub PR lifecycle facts, not just persisted local state, to expose stale `blocked`/`failed` records.
- What changed: Added `src/supervisor/tracked-pr-mismatch.ts`; wired mismatch summaries and guidance into `status`, `doctor`, and `explain`; added focused regression tests for all three surfaces; then fixed backend/browser/service test fixtures to include the new `trackedPrMismatchSummary` and `recoveryGuidance` DTO fields.
- Current blocker: None.
- Next exact step: Keep the branch reviewable and use draft PR `#1161` for review while keeping unrelated broad-suite failures out of this issue scope.
- Verification gap: Broad `npm test` still fails in unrelated baseline tests (`supervisor-pr-readiness`, `supervisor-recovery-failure-flows`, `supervisor-selection-readiness-summary`, `supervisor-status-rendering`, long browser smoke cases) that are outside the touched mismatch-diagnostics surface.
- Files touched: src/supervisor/tracked-pr-mismatch.ts; src/supervisor/supervisor.ts; src/supervisor/supervisor-selection-issue-explain.ts; src/doctor.ts; src/supervisor/supervisor-diagnostics-status-selection.test.ts; src/supervisor/supervisor-diagnostics-explain.test.ts; src/doctor.test.ts; src/backend/supervisor-http-server.test.ts; src/backend/webui-dashboard-browser-smoke.test.ts; src/supervisor/supervisor-service.test.ts
- Rollback concern: Low; the change is additive diagnostics-only logic that does not mutate tracked state.
- Last focused command: npx tsx --test src/backend/supervisor-http-server.test.ts
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
