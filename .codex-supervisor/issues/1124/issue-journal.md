# Issue #1124: Extract trust and config warning formatting from doctor and status surfaces

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1124
- Branch: codex/issue-1124
- Workspace: .
- Journal: .codex-supervisor/issues/1124/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: bf7d80e2ff84ca9015c7b76ea77693f4626e5f4d
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-27T15:22:15.799Z

## Latest Codex Summary
- Extracted shared warning helpers so `doctor` and `status` no longer hand-assemble the execution-safety warning line separately, and added focused regressions for warning and non-warning trust postures.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: Trust/config-style warnings were being formatted independently in `doctor` and `status`, which risks drift when warning kinds or visibility rules change.
- What changed: Added `src/warning-formatting.ts`, routed `renderDoctorReport()` and `renderSupervisorStatusDto()` through it, and added focused no-warning regressions in `src/doctor.test.ts` and `src/supervisor/supervisor-diagnostics-status-selection.test.ts`.
- Current blocker: None on the code path; full local typecheck is environment-blocked because the workspace does not have local TypeScript deps installed and `npx -p typescript tsc` cannot find `@types/node` while also flagging the repo's deprecated `moduleResolution=node10` setting under the fetched TS version.
- Next exact step: Commit the warning-helper refactor and focused regressions on `codex/issue-1124`.
- Verification gap: `npx --yes -p typescript tsc -p tsconfig.json` did not complete successfully in this environment; focused runtime tests passed.
- Files touched: src/warning-formatting.ts; src/doctor.ts; src/doctor.test.ts; src/supervisor/supervisor-status-report.ts; src/supervisor/supervisor-diagnostics-status-selection.test.ts
- Rollback concern: Low; the change is isolated to warning-line construction and preserves existing operator-facing strings.
- Last focused command: npx --yes tsx --test src/config.test.ts src/doctor.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
