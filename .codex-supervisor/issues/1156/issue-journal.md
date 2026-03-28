# Issue #1156: Capture real loop-path inventory refresh failures before hardening degraded full-inventory recovery

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1156
- Branch: codex/issue-1156
- Workspace: .
- Journal: .codex-supervisor/issues/1156/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 114b482ed45d061a8d29b53de11b10defbb8d2d2
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-28T07:16:21.409Z

## Latest Codex Summary
- Reproduced the loop-path gap and implemented narrow instrumentation so supervisor-owned full-inventory refreshes now auto-capture malformed payload evidence, preserve structured primary/fallback diagnostics in `inventory_refresh_failure`, and expose those diagnostics through degraded-state reporting.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: The GitHub client already knew how to capture malformed inventory payloads, but the real supervisor loop was not enabling that capture automatically and the prelude/state path collapsed transport-specific evidence down to a flat message before persistence.
- What changed: Added loop-owned malformed-inventory capture activation in `Supervisor.listLoopIssueInventory`; expanded GitHub inventory failures into structured primary/fallback diagnostics with artifact paths, command, parse error, byte counts, and capture metadata; persisted those diagnostics through state-store normalization; surfaced diagnostic lines in degraded status/explain output; added focused regression tests for capture wiring and diagnostics preservation.
- Current blocker: none.
- Next exact step: Review the persisted artifact shape against a real loop failure and, if needed, add any missing host-context fields before resilience changes.
- Verification gap: No live loop failure was available in this workspace, so validation is test/build-based rather than host-observed.
- Files touched: src/github/github.ts; src/inventory-refresh-state.ts; src/core/types.ts; src/core/state-store.ts; src/supervisor/supervisor.ts; related focused tests.
- Rollback concern: Diagnostic entries now persist in state; rollback would need to tolerate or ignore the added `inventory_refresh_failure.diagnostics` field if older code reads newer state.
- Last focused command: `npm run build`
### Scratchpad
- Verification: `npx tsx --test src/core/state-store.test.ts src/github/github.test.ts src/run-once-cycle-prelude.test.ts src/supervisor/supervisor.test.ts`; `npm run test:malformed-inventory-regressions`; `npm run build`.
