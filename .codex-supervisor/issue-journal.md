# Issue #768: Waiting PR recheck cadence: reevaluate waiting_ci faster after provider progress

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/768
- Branch: codex/issue-768
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: ab7d368a45723606dda6eff4c7fafeb95964e095
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-21T10:39:10Z

## Latest Codex Summary
- Added a `waiting_ci`-specific cadence selector that uses `mergeCriticalRecheckSeconds` only for fresh PR/provider-progress waits on the active issue, switched the loop runtime to re-read cadence between cycles, and added focused lifecycle/runtime tests for the new behavior.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the regression is confined to loop cadence selection, because `waiting_ci` lifecycle state already records fresh PR/provider progress but the runtime always sleeps on the general cadence captured at loop startup.
- What changed: added `selectSupervisorPollIntervalMs` to keep the faster cadence limited to active `waiting_ci` records with fresh current-head progress (`review_wait_started_at`, `copilot_review_requested_observed_at`, or `provider_success_observed_at`); changed `Supervisor.pollIntervalMs()` to read the active state and pick the effective cadence; and changed the loop runtime to query cadence before each sleep instead of caching it once.
- Current blocker: none
- Next exact step: review the diff, commit the cadence change on `codex/issue-768`, and open or update the branch PR if needed.
- Verification gap: none in the focused suites; `.codex-supervisor/replay/` remains untracked and untouched.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/cli/supervisor-runtime.test.ts`, `src/cli/supervisor-runtime.ts`, `src/supervisor/supervisor-lifecycle.test.ts`, `src/supervisor/supervisor-lifecycle.ts`, `src/supervisor/supervisor-service.ts`, `src/supervisor/supervisor.ts`
- Rollback concern: reverting the runtime cadence refresh without reverting the selector would leave the `waiting_ci` recheck policy partially implemented but ineffective in long-running loop mode.
- Last focused command: `npm run build`
- Last focused failure: `none`
- Last focused commands:
```bash
npx tsx --test src/supervisor/supervisor-lifecycle.test.ts
npx tsx --test src/cli/supervisor-runtime.test.ts
npx tsx --test src/supervisor/supervisor-pr-readiness.test.ts src/supervisor/supervisor-lifecycle.test.ts
npm install
npm run build
```
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
