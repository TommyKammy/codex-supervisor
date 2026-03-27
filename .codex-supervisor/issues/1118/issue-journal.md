# Issue #1118: Warn when the active supervisor config still uses the legacy shared issue journal path

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1118
- Branch: codex/issue-1118
- Workspace: .
- Journal: .codex-supervisor/issues/1118/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: bf7d80e2ff84ca9015c7b76ea77693f4626e5f4d
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-27T13:40:18.841Z

## Latest Codex Summary
- Added an operator-visible legacy issue-journal-path warning through the shared trust/config diagnostics, rendered in both `doctor` and `status`.
- Added focused regression coverage for legacy-path warning emission and for non-warning issue-scoped/custom-path cases.
- Verified with focused `tsx` tests and a full TypeScript build after installing pinned dev dependencies with `npm ci`.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: The smallest safe fix is to reuse existing operator diagnostics by attaching a legacy journal-path warning to the shared config/trust summary instead of adding a new startup-only path.
- What changed: Added legacy-path detection in `summarizeTrustDiagnostics`, rendered it as `doctor_warning kind=config` and `config_warning=...`, and added focused tests for warning and non-warning cases.
- Current blocker: none
- Next exact step: Commit the checkpoint on `codex/issue-1118` and leave the branch ready for PR/draft PR follow-up.
- Verification gap: Full `npm test` was not used as a signal because the broad script pulled in unrelated browser-smoke coverage; focused diagnostics tests and `npm run build` passed.
- Files touched: src/core/config.ts; src/core/types.ts; src/doctor.ts; src/doctor.test.ts; src/config.test.ts; src/setup-readiness.ts; src/supervisor/supervisor-status-report.ts; src/supervisor/supervisor-diagnostics-status-selection.test.ts
- Rollback concern: Low; the change is additive and only emits warnings when the configured path exactly matches the legacy shared journal path.
- Last focused command: npm run build
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
