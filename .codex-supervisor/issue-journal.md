# Issue #766: Merge latency visibility: record provider-observation and reevaluation timestamps

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/766
- Branch: codex/issue-766
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: fce9f0b5fc40a245e4a52ec4bc0e7cd5a4480989
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-21T07:43:53.245Z

## Latest Codex Summary
- Added informational merge-latency visibility fields to the issue record, persisted from PR lifecycle reevaluations and surfaced in status/replay artifacts with focused tests.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the missing visibility belongs in the PR lifecycle patch layer, because that is where the supervisor already persists informational review-wait timing without changing merge policy.
- What changed: added nullable record fields for `provider_success_observed_at`, `provider_success_head_sha`, and `merge_readiness_last_evaluated_at`; normalized and patched them through `StateStore`; added `syncMergeLatencyVisibility()` in `src/pull-request-state.ts`; wired the resulting patch through `derivePullRequestLifecycleSnapshot()` and post-turn persistence; cleared the fields on requeue/new-record reset paths; surfaced the fields in detailed status and replay cycle snapshots; and tightened focused tests in `src/supervisor/supervisor-lifecycle.test.ts`, `src/supervisor/supervisor-status-model.test.ts`, and `src/supervisor/supervisor-cycle-snapshot.test.ts`.
- Current blocker: none
- Next exact step: commit this checkpoint on `codex/issue-766`, then open/update the draft PR and run any missing broader verification once TypeScript tooling is available in the worktree.
- Verification gap: `npm run build` cannot complete here because `tsc`/`typescript` is not installed in the worktree, so only focused `tsx --test` verification ran.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/core/state-store.ts`, `src/core/types.ts`, `src/post-turn-pull-request.ts`, `src/pull-request-state.ts`, `src/recovery-reconciliation.ts`, `src/run-once-issue-selection.ts`, `src/supervisor/replay-corpus-validation.ts`, `src/supervisor/supervisor-cycle-snapshot.test.ts`, `src/supervisor/supervisor-cycle-snapshot.ts`, `src/supervisor/supervisor-detailed-status-assembly.ts`, `src/supervisor/supervisor-lifecycle.test.ts`, `src/supervisor/supervisor-lifecycle.ts`, `src/supervisor/supervisor-status-model.test.ts`
- Rollback concern: removing the lifecycle visibility patching or status/snapshot wiring would erase the only persisted distinction between provider delay and supervisor reevaluation delay for active PR heads.
- Last focused command: `npx tsx --test src/supervisor/supervisor-lifecycle.test.ts src/supervisor/supervisor-status-model.test.ts src/supervisor/supervisor-cycle-snapshot.test.ts`
- Last focused failure: `build-tooling-missing:tsc-not-installed`
- Last focused commands:
```bash
npx tsx --test src/supervisor/supervisor-lifecycle.test.ts
npx tsx --test src/supervisor/supervisor-status-model.test.ts
npx tsx --test src/supervisor/supervisor-cycle-snapshot.test.ts
npx tsx --test src/supervisor/supervisor-pr-readiness.test.ts
npx tsx --test src/core/state-store.test.ts
npm run build
npx tsc -p tsconfig.json
date -u +"%Y-%m-%dT%H:%M:%SZ"
```
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
