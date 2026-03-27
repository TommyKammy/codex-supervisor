# Issue #1124: Extract trust and config warning formatting from doctor and status surfaces

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1124
- Branch: codex/issue-1124
- Workspace: .
- Journal: .codex-supervisor/issues/1124/issue-journal.md
- Current phase: stabilizing
- Attempt count: 2 (implementation=2, repair=0)
- Last head SHA: 31d2f2d6d90c9fe6534d1a70c062bc4e54b30a42
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-27T15:30:49Z

## Latest Codex Summary
Shared warning construction remains centralized in [warning-formatting.ts](src/warning-formatting.ts). Both [doctor.ts](src/doctor.ts) and [supervisor-status-report.ts](src/supervisor/supervisor-status-report.ts) still use the same helper for execution-safety and other warning lines, so the operator-visible strings stay the same while the duplicate wiring stays removed.

Focused regressions in [doctor.test.ts](src/doctor.test.ts) and [supervisor-diagnostics-status-selection.test.ts](src/supervisor/supervisor-diagnostics-status-selection.test.ts) still cover both warning and non-warning trust postures. The implementation checkpoint remains committed as `31d2f2d` (`Extract shared warning formatting`), and there is still no PR open for `codex/issue-1124`.

`npx --yes tsx --test src/config.test.ts src/doctor.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts` passed again on 2026-03-27. I did not retry the ad hoc `npx --yes -p typescript tsc -p tsconfig.json` command because the earlier failure was environmental: local `@types/node` is missing and the fetched TypeScript version errors on the repo’s deprecated `moduleResolution=node10` setting.

Summary: Validated the shared warning-formatting checkpoint, confirmed focused warning/non-warning coverage still passes, and prepared the branch for draft PR publication.
State hint: stabilizing
Blocked reason: none
Tests: `npx --yes tsx --test src/config.test.ts src/doctor.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts` passed
Next action: Push `codex/issue-1124` and open a draft PR for commit `31d2f2d`.
Failure signature: none

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: Trust/config-style warnings were being formatted independently in `doctor` and `status`, which risks drift when warning kinds or visibility rules change.
- What changed: Added `src/warning-formatting.ts`, routed `renderDoctorReport()` and `renderSupervisorStatusDto()` through it, and added focused no-warning regressions in `src/doctor.test.ts` and `src/supervisor/supervisor-diagnostics-status-selection.test.ts`.
- Current blocker: None on the code path. The only remaining verification caveat is the previously observed ad hoc `npx -p typescript tsc` environment failure (`@types/node` missing locally and TS5107 against `moduleResolution=node10` under the fetched TS version), which was not retried because it is unrelated to this focused change.
- Next exact step: Push `codex/issue-1124` and open the draft PR from commit `31d2f2d`.
- Verification gap: No focused runtime gap. The warning/config/status tests passed again; full ad hoc typecheck remains environment-limited if needed later.
- Files touched: src/warning-formatting.ts; src/doctor.ts; src/doctor.test.ts; src/supervisor/supervisor-status-report.ts; src/supervisor/supervisor-diagnostics-status-selection.test.ts
- Rollback concern: Low; the change is isolated to warning-line construction and preserves existing operator-facing strings.
- Last focused command: npx --yes tsx --test src/config.test.ts src/doctor.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
- 2026-03-27T15:30:49Z: Re-ran focused warning/config/status verification after handoff review; tests passed and no code changes were needed beyond this journal update.
