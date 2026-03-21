# Issue #766: Merge latency visibility: record provider-observation and reevaluation timestamps

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/766
- Branch: codex/issue-766
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: repairing_ci
- Attempt count: 2 (implementation=1, repair=1)
- Last head SHA: 3bb551d60c09bff6ce14c2e8503d1087b97cad62
- Blocked reason: none
- Last failure signature: build (ubuntu-latest):fail|build (macos-latest):fail
- Repeated failure signature count: 1
- Updated at: 2026-03-21T08:10:18.878Z

## Latest Codex Summary
Reproduced the failing PR #770 build jobs from Actions. The concrete failures were:
- `npx tsx src/index.ts replay-corpus`: checked-in replay corpus snapshots were missing the newly added merge-latency fields, so validation rejected them.
- `npm run build`: strict test mocks in `src/post-turn-pull-request.test.ts` and `src/run-once-turn-execution.test.ts` were missing the required `mergeLatencyVisibilityPatch` property on `PullRequestLifecycleSnapshot`.

Repaired the CI break by backfilling the checked-in replay corpus snapshots with explicit null merge-latency fields, updating the strict lifecycle snapshot test doubles, and refreshing the CLI replay tests in `src/index.test.ts` so their temporary snapshots and promotion-hint fixture match the new schema and current hint rules.

Summary: Repaired the PR #770 build failures by fixing replay corpus fixtures and strict lifecycle snapshot test doubles for the new merge-latency visibility fields.
State hint: repairing_ci
Blocked reason: none
Tests: npm ci; npm run build; npx tsx src/index.ts replay-corpus; npx tsx --test src/supervisor/supervisor-diagnostics-status-selection.test.ts src/supervisor/supervisor-status-model.test.ts src/post-turn-pull-request.test.ts src/run-once-turn-execution.test.ts src/index.test.ts
Failure signature: none
Next action: Commit this CI repair on `codex/issue-766`, push the branch, and recheck PR #770 status.

## Active Failure Context
- Category: checks
- Summary: PR #770 has failing checks.
- Command or source: gh pr checks
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/770
- Details:
  - build (ubuntu-latest) (fail/FAILURE) https://github.com/TommyKammy/codex-supervisor/actions/runs/23375173869/job/68005868684
  - build (macos-latest) (fail/FAILURE) https://github.com/TommyKammy/codex-supervisor/actions/runs/23375173869/job/68005868702

## Codex Working Notes
### Current Handoff
- Hypothesis: the remaining CI break was fixture drift rather than feature logic, because the new informational fields changed replay-corpus schema and the strict snapshot interface used by a few tests.
- What changed: added explicit null `provider_success_observed_at`, `provider_success_head_sha`, and `merge_readiness_last_evaluated_at` fields to every checked-in replay corpus input snapshot; added `mergeLatencyVisibilityPatch` to the `PullRequestLifecycleSnapshot` test doubles in `src/post-turn-pull-request.test.ts` and `src/run-once-turn-execution.test.ts`; and updated the CLI replay tests in `src/index.test.ts` so their temporary snapshots include the new fields and the promotion-hint coverage uses a snapshot that actually satisfies `stale-head-safety`.
- Current blocker: none
- Next exact step: commit and push the repair, then confirm PR #770 checks rerun green.
- Verification gap: none for the reproduced CI commands; the untracked `.codex-supervisor/replay/` workspace artifact remains present but did not affect the repair.
- Files touched: `.codex-supervisor/issue-journal.md`, `replay-corpus/cases/provider-wait-initial-grace/input/snapshot.json`, `replay-corpus/cases/provider-wait-settled-after-observation/input/snapshot.json`, `replay-corpus/cases/repeated-failure-escalates-to-failed/input/snapshot.json`, `replay-corpus/cases/required-check-pending/input/snapshot.json`, `replay-corpus/cases/review-blocked/input/snapshot.json`, `replay-corpus/cases/review-timing-ready-for-review-after-draft-skip/input/snapshot.json`, `replay-corpus/cases/stale-head-prevents-merge/input/snapshot.json`, `replay-corpus/cases/timeout-retry-budget-progression/input/snapshot.json`, `replay-corpus/cases/verification-blocker-retry-exhausted/input/snapshot.json`, `src/index.test.ts`, `src/post-turn-pull-request.test.ts`, `src/run-once-turn-execution.test.ts`
- Rollback concern: dropping the replay-corpus fixture backfill or the added snapshot patch property would re-break the exact CI jobs currently failing on PR #770.
- Last focused command: `npx tsx --test src/supervisor/supervisor-diagnostics-status-selection.test.ts src/supervisor/supervisor-status-model.test.ts src/post-turn-pull-request.test.ts src/run-once-turn-execution.test.ts src/index.test.ts`
- Last focused failure: `none`
- Last focused commands:
```bash
npm ci
gh run view 23375173869 --log-failed
npm run build
npx tsx src/index.ts replay-corpus
npx tsx --test src/supervisor/supervisor-diagnostics-status-selection.test.ts src/supervisor/supervisor-status-model.test.ts src/post-turn-pull-request.test.ts src/run-once-turn-execution.test.ts src/index.test.ts
npx tsx --test src/index.test.ts
npx tsx --test src/supervisor/supervisor-diagnostics-status-selection.test.ts src/supervisor/supervisor-status-model.test.ts src/post-turn-pull-request.test.ts src/run-once-turn-execution.test.ts src/index.test.ts
npx tsx src/index.ts replay-corpus
npm run build
date -u +"%Y-%m-%dT%H:%M:%SZ"
```
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
