# Issue #893: Execution metrics enrichment: add core lifecycle and PR milestone fields

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/893
- Branch: codex/issue-893
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 8121cfeb93e4d994e68aed8143c984a03c305bec
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-23T18:11:47Z

## Latest Codex Summary
- Reproduced the missing lifecycle fields with a focused execution-metrics test, then implemented schema v2 run summaries with derived lifecycle durations, PR milestones, and structured terminal outcomes across all terminal write paths.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: issue #893 is satisfied by deriving enriched run-summary lifecycle fields from existing issue, run, and PR timestamps at write time, then validating the persisted artifact against a stricter schema version.
- What changed: added `src/supervisor/execution-metrics-lifecycle.ts` plus `src/supervisor/execution-metrics-lifecycle.test.ts` to derive non-negative durations and structured terminal outcomes; bumped `src/supervisor/execution-metrics-schema.ts` to schema version 2 with lifecycle and PR milestone fields; updated `src/supervisor/execution-metrics-run-summary.ts` and all terminal summary write paths to pass issue, PR, blocked-reason, and failure-kind metadata; expanded execution-metrics and failure-helper tests to cover the new contract.
- Current blocker: none
- Next exact step: review the final diff, commit the enriched execution-metrics changes on `codex/issue-893`, and open or update a draft PR if one is still absent.
- Verification gap: none in the requested scope after `npm ci`; build, focused execution-metrics tests, and the touched failure-helper regression tests all pass.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/run-once-issue-preparation.ts`, `src/run-once-turn-execution.ts`, `src/supervisor/execution-metrics-lifecycle.ts`, `src/supervisor/execution-metrics-lifecycle.test.ts`, `src/supervisor/execution-metrics-run-summary.ts`, `src/supervisor/execution-metrics-run-summary.test.ts`, `src/supervisor/execution-metrics-schema.ts`, `src/supervisor/execution-metrics-schema.test.ts`, `src/supervisor/supervisor-failure-helpers.ts`, `src/supervisor/supervisor-recovery-failure-flows.test.ts`, `src/supervisor/supervisor.ts`, `src/turn-execution-failure-helpers.ts`, `src/turn-execution-failure-helpers.test.ts`
- Rollback concern: medium-low; schema version 2 changes the persisted run-summary shape, so any out-of-tree consumers expecting version 1 would need a matching update.
- Last focused command: `npx tsx --test src/supervisor/execution-metrics-run-summary.test.ts src/supervisor/execution-metrics-lifecycle.test.ts src/turn-execution-failure-helpers.test.ts src/supervisor/supervisor-recovery-failure-flows.test.ts`
- Last focused failure: `npm run build` initially failed with `sh: 1: tsc: not found` because this worktree had no `node_modules`; `npm ci` resolved the environment issue and the subsequent build passed.
- Last focused commands:
```bash
sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-893/AGENTS.generated.md
sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-893/context-index.md
sed -n '1,260p' .codex-supervisor/issue-journal.md
git status --short
git branch --show-current && git rev-parse HEAD
rg -n "execution-metrics|run summary|run-summary|lifecycle|pr milestone|close reason" src . --glob '!node_modules'
rg --files src | rg 'execution-metrics|lifecycle|summary'
sed -n '1,260p' src/supervisor/execution-metrics-run-summary.ts
sed -n '1,260p' src/supervisor/execution-metrics-schema.ts
sed -n '1,620p' src/supervisor/execution-metrics-run-summary.test.ts
sed -n '1,220p' src/supervisor/execution-metrics-schema.test.ts
sed -n '1,240p' src/run-once-turn-execution.ts
sed -n '1,260p' src/turn-execution-failure-helpers.ts
apply_patch
npx tsx --test src/supervisor/execution-metrics-run-summary.test.ts
apply_patch
npx tsx --test src/supervisor/execution-metrics-run-summary.test.ts src/supervisor/execution-metrics-schema.test.ts src/supervisor/execution-metrics-lifecycle.test.ts
npm run build
npm ci
npm run build
npx tsx --test src/supervisor/execution-metrics-run-summary.test.ts src/supervisor/execution-metrics-lifecycle.test.ts src/turn-execution-failure-helpers.test.ts src/supervisor/supervisor-recovery-failure-flows.test.ts
git diff -- src/supervisor/execution-metrics-schema.ts src/supervisor/execution-metrics-lifecycle.ts src/supervisor/execution-metrics-run-summary.ts src/supervisor/execution-metrics-run-summary.test.ts src/supervisor/execution-metrics-schema.test.ts src/supervisor/execution-metrics-lifecycle.test.ts src/run-once-issue-preparation.ts src/run-once-turn-execution.ts src/turn-execution-failure-helpers.ts src/turn-execution-failure-helpers.test.ts src/supervisor/supervisor.ts src/supervisor/supervisor-failure-helpers.ts src/supervisor/supervisor-recovery-failure-flows.test.ts
date -u +%Y-%m-%dT%H:%M:%SZ
apply_patch
```
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
