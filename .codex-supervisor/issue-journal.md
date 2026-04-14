# Issue #1514: Bug: doctor/status hydrate tracked PR diagnostics for every historical done record with pr_number

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1514
- Branch: codex/issue-1514
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 19ac2f5ff0bd8bbea2be8182596f1cdb0a96bfef
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-04-14T07:39:00.156Z

## Latest Codex Summary
- Reproduced the regression with focused counter-based tests, then narrowed default tracked-PR hydration in `doctor` and `status` to skip historical `done` records while preserving actionable blocked tracked-PR mismatch diagnostics.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: Default read-only tracked-PR diagnostics were hydrating every record with `pr_number`, including historical terminal `done` entries that can never produce actionable mismatch output.
- What changed: Added regression tests for `doctor` and `status` that seed 160 historical `done + pr_number` records plus one blocked actionable record; introduced `shouldHydrateTrackedPrDiagnostics(...)` and used it in both read-only hydration loops to skip terminal `done` records before PR fetches.
- Current blocker: none
- Next exact step: Commit the reproducer-plus-fix checkpoint on `codex/issue-1514`.
- Verification gap: none for the requested local scope; the targeted test files and `npm run build` pass.
- Files touched: .codex-supervisor/issue-journal.md, src/doctor.ts, src/supervisor/supervisor-read-only-reporting.ts, src/supervisor/tracked-pr-mismatch.ts, src/doctor.test.ts, src/supervisor/supervisor-diagnostics-status-selection.test.ts
- Rollback concern: Low; the new guard only skips tracked-PR hydration for terminal `done` records and leaves non-terminal tracked PR records on the existing path.
- Last focused command: npx tsx --test src/doctor.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
