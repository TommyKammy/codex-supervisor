# Issue #1124: Extract trust and config warning formatting from doctor and status surfaces

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1124
- Branch: codex/issue-1124
- Workspace: .
- Journal: .codex-supervisor/issues/1124/issue-journal.md
- Current phase: waiting_ci
- Attempt count: 3 (implementation=2, repair=1)
- Last head SHA: 7bf387edb7250c1a808f486a39b89a3a350ce2eb
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-27T15:47:52Z

## Latest Codex Summary
Merged `github/main` at `d4986e5` into `codex/issue-1124` as merge commit `7bf387e`. The conflict resolution kept the shared warning-formatting path by expanding [src/warning-formatting.ts](src/warning-formatting.ts) to emit both execution-safety and config warnings, while preserving the new GitHub rate-limit status lines from `main` in [src/supervisor/supervisor-status-report.ts](src/supervisor/supervisor-status-report.ts).

Focused verification passed with `npx --yes tsx --test src/config.test.ts src/doctor.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts`. I also aligned [src/config.test.ts](src/config.test.ts), [src/doctor.test.ts](src/doctor.test.ts), and [src/supervisor/supervisor-diagnostics-status-selection.test.ts](src/supervisor/supervisor-diagnostics-status-selection.test.ts) with `main`'s preferred default issue-journal path while keeping legacy-path warning coverage intact for the issue-specific behavior under test.

Summary: Merged `github/main` into `codex/issue-1124`, resolved the doctor/status warning-formatting conflicts conservatively, re-passed the focused config/doctor/status suite, and pushed the refreshed branch to both remotes.
State hint: waiting_ci
Blocked reason: none
Tests: `npx --yes tsx --test src/config.test.ts src/doctor.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts` passed
Next action: Monitor draft PR #1130 for CI and review feedback after the refreshed push.
Failure signature: none

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: `main` added config-warning defaults and GitHub rate-limit status lines that overlapped with issue #1124's extracted warning helper; the merge should preserve both instead of falling back to duplicated manual warning wiring.
- What changed: Merged `github/main` at `d4986e5`, expanded `src/warning-formatting.ts` to build both execution-safety and config warnings, routed `renderDoctorReport()` and `renderSupervisorStatusDto()` through the shared helper again, and updated focused expectations in `src/config.test.ts`, `src/doctor.test.ts`, and `src/supervisor/supervisor-diagnostics-status-selection.test.ts` to match `main`'s safer default journal path while retaining legacy-path warning coverage.
- Current blocker: None. Merge conflicts in `src/doctor.ts` and `src/supervisor/supervisor-status-report.ts` are resolved and the focused suite passes.
- Next exact step: Monitor PR #1130 CI and review feedback on the refreshed branch head.
- Verification gap: No focused runtime gap. I did not retry the earlier ad hoc `npx --yes -p typescript tsc -p tsconfig.json` check because the prior failure was environmental (`@types/node` missing locally and TS5107 against `moduleResolution=node10` under the fetched TypeScript version).
- Files touched: src/warning-formatting.ts; src/doctor.ts; src/supervisor/supervisor-status-report.ts; src/config.test.ts; src/doctor.test.ts; src/supervisor/supervisor-diagnostics-status-selection.test.ts
- Rollback concern: Low; the merge resolution is localized to warning-line rendering and test expectation alignment with `main`.
- Last focused command: npx --yes tsx --test src/config.test.ts src/doctor.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
- 2026-03-27T15:44:01Z: Re-ran `npx --yes tsx --test src/config.test.ts src/doctor.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts` after resolving the merge conflicts; the focused suite passed.
- 2026-03-27T15:46:15Z: Recorded the `github/main` merge resolution and pending push after integrating `d4986e5` into `codex/issue-1124`.
- 2026-03-27T15:47:52Z: Pushed `codex/issue-1124` to both `github` and `origin` after the merge-resolution and journal commits.
