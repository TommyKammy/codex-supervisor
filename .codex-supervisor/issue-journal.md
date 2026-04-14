# Issue #1508: Parent epic auto-closure should be surfaced as an explicit recovery event

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1508
- Branch: codex/issue-1508
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 941fafe431cfdbb1d366c55e73e3309775acce5f
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-04-14T05:48:45.077Z

## Latest Codex Summary
- Added explicit `parent_epic_auto_closed` recovery events to parent epic closure reconciliation, threaded those events through prelude recovery aggregation, and covered the operator-facing status surface via `latest_recovery`.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: Parent epic auto-closure can reuse the existing recovery-event and `latest_recovery` plumbing if reconciliation returns a typed event and persists it on the parent issue record.
- What changed: `reconcileParentEpicClosures(...)` now returns `parent_epic_auto_closed` recovery events with parent and child issue numbers, applies the recovery metadata to tracked parent records, and `runOnceCyclePrelude(...)` now carries/emits those events like other recoveries. Added focused coverage for reconciliation, prelude aggregation, and read-only status rendering.
- Current blocker: None on the issue implementation. The literal `npm test -- ...` command still expands to the repository's full suite and surfaced unrelated baseline failures outside this issue.
- Next exact step: Commit the checkpoint and, if desired, open/update the draft PR with the focused verification results plus the note that repo-wide `npm test -- ...` currently exercises unrelated failing tests.
- Verification gap: Issue-targeted suites and `npm run build` pass. The literal `npm test -- src/...` command is not isolateable in this repo because the `test` script also runs `src/**/*.test.ts`, which surfaced unrelated failures in `supervisor-pr-readiness`, `supervisor-status-model-supervisor`, and `tracked-pr-lifecycle-projection`.
- Files touched: src/recovery-reconciliation.ts; src/run-once-cycle-prelude.ts; src/supervisor/supervisor-recovery-reconciliation.test.ts; src/run-once-cycle-prelude.test.ts; src/supervisor/supervisor-diagnostics-status-selection.test.ts
- Rollback concern: Low. The change is additive to recovery visibility and preserves existing closure eligibility/side effects.
- Last focused command: npm run build
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
