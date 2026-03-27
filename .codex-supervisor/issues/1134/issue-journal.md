# Issue #1134: Recognize bullet-prefixed Part of metadata in parent epic auto-close reconciliation

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1134
- Branch: codex/issue-1134
- Workspace: .
- Journal: .codex-supervisor/issues/1134/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 656fad1013f8ca887e435c621f7ff1b3a969d8c1
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-27T22:00:51.309Z

## Latest Codex Summary
- Added focused regression coverage proving `- Part of: #<n>` was ignored by `parseIssueMetadata()`, which prevented parent epic auto-close candidate discovery.
- Updated parser, validation, and execution-ready `Part of` checks to recognize bullet-prefixed metadata while preserving existing bare-line and canonical colon forms.
- Verified the parser, issue-metadata, and degraded parent-closure prelude paths; the targeted parent-closure reconciliation test passes with bullet-prefixed child metadata.

## Active Failure Context
- Requested full-file verification for `src/supervisor/supervisor-recovery-reconciliation.test.ts` still has a pre-existing unrelated failure: `reconcileRecoverableBlockedIssueStates requeues requirements-blocked issues once metadata is execution-ready` throws `lintExecutionReadyIssueBody requires issue.labels`.

## Codex Working Notes
### Current Handoff
- Hypothesis: Parent epic auto-close missed closed children because bullet-prefixed `- Part of: #<n>` lines were not parsed as parent metadata.
- What changed: Added bullet-prefixed regression tests and broadened `Part of` recognition in parser, validation, and readiness checks to treat `- Part of: #<n>` like the existing bare-line forms.
- Current blocker: None for this issue; remaining failure is an unrelated pre-existing missing-labels test setup in `src/supervisor/supervisor-recovery-reconciliation.test.ts`.
- Next exact step: Commit the fix on `codex/issue-1134`; if broader stabilization is required afterward, inspect the unrelated missing-labels reconciliation test separately.
- Verification gap: Full `src/supervisor/supervisor-recovery-reconciliation.test.ts` file is not clean because of the unrelated `issue.labels` failure, but the targeted parent-closure reconciliation test passes.
- Files touched: src/issue-metadata/issue-metadata-parser.ts; src/issue-metadata/issue-metadata-validation.ts; src/issue-metadata/issue-metadata-gates.ts; src/issue-metadata/issue-metadata-parser.test.ts; src/issue-metadata/issue-metadata.test.ts; src/run-once-cycle-prelude.test.ts; src/supervisor/supervisor-recovery-reconciliation.test.ts
- Rollback concern: Low; change is limited to `Part of` metadata recognition and focused regression coverage.
- Last focused command: `npx tsx --test --test-name-pattern "reconcileParentEpicClosures clears a stale active issue pointer even when the parent record already matches the done patch" src/supervisor/supervisor-recovery-reconciliation.test.ts`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
