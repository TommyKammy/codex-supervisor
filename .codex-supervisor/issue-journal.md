# Issue #1456: Surface preserved partial-work incidents in status and explain

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1456
- Branch: codex/issue-1456
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 9439b93d1dabd2d84642028923ede107a02e3da3
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-04-12T06:52:21.544Z

## Latest Codex Summary
- None yet.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: No-PR manual-review recovery already preserves enough context to identify saved tracked work; the missing piece is recording that signal explicitly and rendering it in operator-facing status/explain output.
- What changed: Added preserved tracked-file metadata to failed no-PR manual-review failure contexts, surfaced it as `partial_work=preserved ...` in `status` and `explain`, and added focused regression coverage for recovery classification, explain DTO/rendering, and status rendering.
- Current blocker: none
- Next exact step: Commit the focused change set, then open or update the draft PR checkpoint if needed.
- Verification gap: Did not rerun the broad `npm test -- ...` package script because it executes the whole suite; used focused `npx tsx --test ...` coverage plus `npm run build`.
- Files touched: src/recovery-support.ts; src/recovery-no-pr-reconciliation.ts; src/supervisor/supervisor-preserved-partial-work.ts; src/supervisor/supervisor-selection-issue-explain.ts; src/supervisor/supervisor-detailed-status-assembly.ts; src/recovery-support.test.ts; src/supervisor/supervisor-recovery-reconciliation.test.ts; src/supervisor/supervisor-diagnostics-explain.test.ts; src/supervisor/supervisor-selection-issue-explain.test.ts; src/supervisor/supervisor-status-rendering.test.ts; src/backend/supervisor-http-server.test.ts; src/backend/webui-dashboard-browser-smoke.test.ts; src/supervisor/supervisor-service.test.ts
- Rollback concern: The new `SupervisorExplainDto.preservedPartialWorkSummary` field required stub updates in backend/service tests; any downstream handwritten DTO fixture will now need the nullable field.
- Last focused command: npm run build
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
