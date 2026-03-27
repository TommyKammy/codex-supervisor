# Issue #1124: Extract trust and config warning formatting from doctor and status surfaces

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1124
- Branch: codex/issue-1124
- Workspace: .
- Journal: .codex-supervisor/issues/1124/issue-journal.md
- Current phase: repairing_ci
- Attempt count: 4 (implementation=2, repair=2)
- Last head SHA: b0bc07a98c72758f7d026ed83b4ba179cd58266c
- Blocked reason: none
- Last failure signature: build (ubuntu-latest):fail|build (macos-latest):fail
- Repeated failure signature count: 1
- Updated at: 2026-03-27T15:54:29.802Z

## Latest Codex Summary
Merged `github/main` into `codex/issue-1124`, resolved the two conflicts in [src/doctor.ts](src/doctor.ts) and [src/supervisor/supervisor-status-report.ts](src/supervisor/supervisor-status-report.ts) by extending the shared helper in [src/warning-formatting.ts](src/warning-formatting.ts) to cover both execution-safety and config warnings while keeping the new rate-limit lines from `main`. I also aligned the focused expectations in [src/config.test.ts](src/config.test.ts), [src/doctor.test.ts](src/doctor.test.ts), and [src/supervisor/supervisor-diagnostics-status-selection.test.ts](src/supervisor/supervisor-diagnostics-status-selection.test.ts) with `main`’s default journal-path behavior.

The issue journal was updated in [.codex-supervisor/issues/1124/issue-journal.md](.codex-supervisor/issues/1124/issue-journal.md), the branch is clean, and `b0bc07a` is pushed to both `github` and `origin`.

Summary: Merged `github/main` into `codex/issue-1124`, resolved the warning-formatting conflicts conservatively, reran focused verification, updated the issue journal, and pushed the refreshed branch.
State hint: waiting_ci
Blocked reason: none
Tests: `npx --yes tsx --test src/config.test.ts src/doctor.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts`
Next action: Monitor PR #1130 checks and any review feedback on the refreshed branch head.
Failure signature: build (ubuntu-latest):fail|build (macos-latest):fail

## Active Failure Context
- Category: checks
- Summary: PR #1130 has failing checks.
- Command or source: gh pr checks
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/1130
- Details:
  - build (ubuntu-latest) (fail/FAILURE) https://github.com/TommyKammy/codex-supervisor/actions/runs/23654904548/job/68909415404
  - build (macos-latest) (fail/FAILURE) https://github.com/TommyKammy/codex-supervisor/actions/runs/23654904548/job/68909415255

## Codex Working Notes
### Current Handoff
- Hypothesis: The refreshed branch is functionally correct, but CI is failing because `renderStatusWarningLine()` still types its sanitizer as returning `string` while `renderSupervisorStatusDto()` passes `sanitizeStatusValue()`, which is explicitly nullable.
- What changed: Reproduced the failure from GitHub Actions run `23654904548`, confirmed both `build` jobs fail in `npm run build` with `TS2345` at `src/supervisor/supervisor-status-report.ts:121` and `:141`, and narrowed it to the shared warning formatter signature. Widened `renderStatusWarningLine()` in `src/warning-formatting.ts` to accept `string | null | undefined`, which matches the existing `truncate()` contract and the status sanitizer already used elsewhere.
- Current blocker: None. Local `npm run build` and the focused config/doctor/status warning tests pass after the type-only repair.
- Next exact step: Commit and push the CI repair on `codex/issue-1124`, then re-check PR #1130 status.
- Verification gap: Remote CI has not been rerun yet on the repaired commit.
- Files touched: src/warning-formatting.ts
- Rollback concern: Low; the change only widens a shared callback type to match an existing nullable sanitizer and does not alter warning text construction.
- Last focused command: npx --yes tsx --test src/config.test.ts src/doctor.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
- 2026-03-27T15:44:01Z: Re-ran `npx --yes tsx --test src/config.test.ts src/doctor.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts` after resolving the merge conflicts; the focused suite passed.
- 2026-03-27T15:46:15Z: Recorded the `github/main` merge resolution and pending push after integrating `d4986e5` into `codex/issue-1124`.
- 2026-03-27T15:47:52Z: Pushed `codex/issue-1124` to both `github` and `origin` after the merge-resolution and journal commits.
- 2026-03-27T15:53:20Z: `gh run view 23654904548 --log-failed` showed both CI jobs failing in `npm run build` with `TS2345` because `renderStatusWarningLine()` expected a non-null sanitizer while `sanitizeStatusValue()` is nullable.
- 2026-03-27T15:55:32Z: Ran `npm ci`, then `npm run build`; the build passed after widening the status warning sanitizer signature in `src/warning-formatting.ts`.
- 2026-03-27T15:56:54Z: Re-ran `npx --yes tsx --test src/config.test.ts src/doctor.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts`; all 84 tests passed.
