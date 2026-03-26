# Issue #1069: Persist a last-known-good inventory snapshot for diagnostics and read-only degraded support

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1069
- Branch: codex/issue-1069
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: b3127d55a8b0077464665bb511c1f14e9e0d703a
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-26T14:47:10.561Z

## Latest Codex Summary
- None yet.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: this issue needs a durable state-level full-inventory artifact, not another live degraded fallback. Persisting a last-known-good snapshot on successful refresh and limiting degraded consumers to explicit diagnostics/readiness reporting should satisfy the acceptance criteria without letting stale inventory regain selection authority.
- What changed: added `last_successful_inventory_snapshot` to supervisor state and state-store normalization; successful `runOnceCyclePrelude()` full refreshes now persist a timestamped, non-authoritative inventory snapshot while clearing `inventory_refresh_failure`; degraded status/report paths now surface snapshot provenance and snapshot-derived readiness lines while keeping `selectionSummary` disabled and `selection_reason=inventory_refresh_degraded`; operator warnings now explicitly call the snapshot diagnostic-only.
- Current blocker: none.
- Next exact step: review the diff for any missing degraded-snapshot guardrail coverage, then commit this checkpoint on `codex/issue-1069` and open/update the draft PR if needed.
- Verification gap: full `npm test` has not been run; focused snapshot/state/status coverage and `npm run build` are green.
- Files touched: `.codex-supervisor/issue-journal.md`; `src/core/state-store.ts`; `src/core/types.ts`; `src/inventory-refresh-state.ts`; `src/run-once-cycle-prelude.ts`; `src/run-once-cycle-prelude.test.ts`; `src/supervisor/supervisor-diagnostics-status-selection.test.ts`; `src/supervisor/supervisor-selection-readiness-summary.ts`; `src/supervisor/supervisor-status-report.ts`; `src/supervisor/supervisor.ts`.
- Rollback concern: low to moderate. The state schema and status/readiness plumbing changed, but the new snapshot remains explicitly non-authoritative and only widens degraded diagnostics.
- Last focused command: `npm run build`
- What changed this turn: reread the required memory files and journal, traced the full-inventory refresh path and degraded status/readiness consumers, added focused tests for successful snapshot persistence and degraded snapshot diagnostics, implemented durable `last_successful_inventory_snapshot` persistence plus sqlite/json normalization, surfaced snapshot provenance and snapshot-derived readiness lines during degraded status reporting without re-enabling live selection, installed local dependencies with `npm ci`, and reran focused tests plus build verification.
- Exact failure reproduced this turn: before the fix, successful full inventory refreshes only cleared `inventory_refresh_failure` and discarded the live issue list, and degraded status paths ignored any durable last-known-good inventory diagnostics entirely; the new prelude and status tests captured both missing behaviors.
- Commands run this turn: `sed -n '1,220p' <always-read-memory>`; `sed -n '1,260p' <context-index>`; `sed -n '1,320p' .codex-supervisor/issue-journal.md`; `git status --short --branch`; `rg -n "inventory snapshot|last-known-good|degraded|inventory refresh|full inventory|reconciliation|authoritative|snapshot" src .`; `rg --files src | rg "inventory|refresh|reconciliation|run-once|supervisor-pr-review|state|snapshot"`; `git log --oneline --decorate -n 12`; `sed -n '1,260p' src/run-once-cycle-prelude.ts`; `sed -n '1,260p' src/inventory-refresh-state.ts`; `sed -n '1,260p' src/core/state-store.ts`; `sed -n '1,260p' src/recovery-reconciliation.ts`; `sed -n '1,320p' src/core/types.ts`; `sed -n '1,260p' src/supervisor/supervisor-selection-issue-explain.ts`; `sed -n '1,220p' src/supervisor/supervisor-status-report.ts`; `sed -n '1,260p' src/supervisor/supervisor-status-model.ts`; `sed -n '430,620p' src/run-once-cycle-prelude.test.ts`; `sed -n '1,260p' src/run-once-issue-selection.ts`; `sed -n '1,260p' src/supervisor/supervisor-selection-readiness-summary.ts`; `sed -n '100,210p' src/supervisor/supervisor-diagnostics-status-selection.test.ts`; `sed -n '140,230p' src/supervisor/supervisor-diagnostics-explain.test.ts`; `sed -n '260,380p' src/supervisor/supervisor-pr-review-blockers.test.ts`; `sed -n '920,1185p' src/supervisor/supervisor.ts`; `apply_patch ...`; `npx tsx --test src/run-once-cycle-prelude.test.ts`; `npx tsx --test src/supervisor/supervisor-diagnostics-status-selection.test.ts`; `test -d node_modules && echo present || echo missing`; `test -f package-lock.json && echo package-lock || echo no-lock`; `npm ci`; `npx tsx --test src/core/state-store.test.ts`; `npm run build`; `git rev-parse HEAD`; `date -u +"%Y-%m-%dT%H:%M:%SZ"`.
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
