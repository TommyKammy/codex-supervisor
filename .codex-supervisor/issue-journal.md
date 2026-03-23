# Issue #894: Execution metrics review loop: capture structured review-iteration metrics

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/894
- Branch: codex/issue-894
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 42936a3cc15e80a430dd699c30d92fd5d2372600
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-23T18:39:24.018Z

## Latest Codex Summary
- None yet.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: issue #894 can be satisfied by deriving a coarse review-loop metrics block at run-summary write time from the already persisted `processed_review_thread_ids`, without changing PR or review handling behavior.
- What changed: bumped `src/supervisor/execution-metrics-schema.ts` to schema version 3 and added a nullable `reviewMetrics` block with a fixed contract: `classification`, `iterationCount`, `totalCount`, and `totalCountKind`; updated `src/supervisor/execution-metrics-lifecycle.ts` to derive `reviewMetrics` from unique `threadId@headSha` history so `iterationCount` counts distinct reviewed heads and `totalCount` counts actionable thread instances; updated `src/supervisor/execution-metrics-run-summary.ts` to pass `processed_review_thread_ids`; expanded `src/supervisor/execution-metrics-schema.test.ts`, `src/supervisor/execution-metrics-lifecycle.test.ts`, and `src/supervisor/execution-metrics-run-summary.test.ts` to cover the new contract and a focused review-loop regression.
- Current blocker: none
- Next exact step: review the final diff, commit the schema v3 review-metrics checkpoint on `codex/issue-894`, and open a draft PR if one still does not exist.
- Verification gap: none in the requested scope after `npm ci`; `npm run build` and the focused execution-metrics tests pass.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/supervisor/execution-metrics-lifecycle.ts`, `src/supervisor/execution-metrics-lifecycle.test.ts`, `src/supervisor/execution-metrics-run-summary.ts`, `src/supervisor/execution-metrics-run-summary.test.ts`, `src/supervisor/execution-metrics-schema.ts`, `src/supervisor/execution-metrics-schema.test.ts`
- Rollback concern: medium-low; schema version 3 extends the persisted run-summary shape, so any external consumers pinned to version 2 would need to handle the new version.
- Last focused command: `npm run build`
- Last focused failure: `npm run build` initially failed with `sh: 1: tsc: not found` because this worktree had no `node_modules`; running `npm ci` resolved the environment issue and the subsequent build passed.
- Last focused commands:
```bash
sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-894/AGENTS.generated.md
sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-894/context-index.md
sed -n '1,260p' .codex-supervisor/issue-journal.md
git status --short
git branch --show-current && git rev-parse HEAD
rg -n "review iteration|review metrics|actionable-thread|processed_review_thread_ids|review_wait_started_at" src . --glob '!node_modules'
sed -n '1,260p' src/supervisor/execution-metrics-run-summary.ts
sed -n '1,260p' src/supervisor/execution-metrics-schema.ts
sed -n '1,240p' src/supervisor/execution-metrics-lifecycle.ts
sed -n '1,620p' src/supervisor/execution-metrics-run-summary.test.ts
sed -n '1,260p' src/supervisor/execution-metrics-schema.test.ts
sed -n '1,260p' src/supervisor/execution-metrics-lifecycle.test.ts
sed -n '1,260p' src/review-handling.ts
sed -n '1,260p' src/review-thread-reporting.ts
sed -n '1,260p' src/core/review-providers.ts
sed -n '1,320p' src/pull-request-state.ts
sed -n '1,260p' src/supervisor/supervisor-lifecycle.ts
apply_patch
npx tsx --test src/supervisor/execution-metrics-schema.test.ts
npx tsx --test src/supervisor/execution-metrics-lifecycle.test.ts
npx tsx --test src/supervisor/execution-metrics-run-summary.test.ts
apply_patch
npx tsx --test src/supervisor/execution-metrics-schema.test.ts src/supervisor/execution-metrics-lifecycle.test.ts src/supervisor/execution-metrics-run-summary.test.ts
npm run build
npm ci
npx tsx --test src/supervisor/execution-metrics-schema.test.ts src/supervisor/execution-metrics-lifecycle.test.ts src/supervisor/execution-metrics-run-summary.test.ts
npm run build
git status --short
date -u +%Y-%m-%dT%H:%M:%SZ
```
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
