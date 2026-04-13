# Issue #1491: Same-head host-local blockers can be cleared as stale when blocker comment publication fails

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1491
- Branch: codex/issue-1491
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: c531613daa6b57a415ab74d7c6294b11d859b966
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-04-13T22:23:19.704Z

## Latest Codex Summary
- None yet.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: Same-head host-local ready-promotion blockers were only considered fresh when local CI failed on the current head or a blocker comment had been persisted, so workspace-preparation and workstation-local-path blockers observed on the current head could be down-ranked as stale if comment publication failed.
- What changed: Added head-scoped `last_observed_host_local_pr_blocker_*` state, recorded it before best-effort blocker comment publication, cleared it after host-local gates pass, taught the ready-promotion freshness helper to trust that observation, and added focused regressions for post-turn, reconciliation, status, explain, and doctor.
- Current blocker: none
- Next exact step: Push the checkpoint commit or open/update the draft PR if the supervisor asks for publication.
- Verification gap: none for the requested local checks; the broad reconciliation test still emits pre-existing execution-metrics warning logs in fixture scenarios, but the suite passes.
- Files touched: .codex-supervisor/issue-journal.md; src/core/types.ts; src/core/state-store.ts; src/core/state-store-normalization.ts; src/post-turn-pull-request.ts; src/tracked-pr-ready-promotion-blocker.ts; src/tracked-pr-lifecycle-projection.ts; src/post-turn-pull-request.test.ts; src/supervisor/supervisor-recovery-reconciliation.test.ts; src/supervisor/supervisor-diagnostics-status-selection.test.ts; src/supervisor/supervisor-diagnostics-explain.test.ts; src/doctor.test.ts; src/supervisor/supervisor-test-helpers.ts; src/turn-execution-test-helpers.ts
- Rollback concern: The new observed-blocker fields are intentionally sticky across same-head reconciliation until a successful ready-promotion pass clears them; if another caller starts reusing those fields outside ready-promotion freshness checks, same-head stale classification could become too conservative.
- Last focused command: node --test --import tsx src/supervisor/supervisor-recovery-reconciliation.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts src/supervisor/supervisor-diagnostics-explain.test.ts src/doctor.test.ts
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
