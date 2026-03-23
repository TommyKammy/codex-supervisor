# Issue #892: Execution metrics schema: define and validate a versioned run-summary contract

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/892
- Branch: codex/issue-892
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: stabilizing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 31b0d794d5b93585cc77a0e6e87d9ee7a73d6966
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-23T17:38:10Z

## Latest Codex Summary
- Added a checked-in execution metrics run-summary contract and now validate artifacts before persistence. Reproduced the gap with a focused failing test for malformed timestamps, then passed `npx tsx --test src/supervisor/execution-metrics-schema.test.ts`, `npx tsx --test src/supervisor/execution-metrics-run-summary.test.ts`, and `npm run build` after `npm ci`, committed the change as `2bd6da1`, pushed `codex/issue-892`, and opened draft PR #905: https://github.com/TommyKammy/codex-supervisor/pull/905

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the issue is satisfied by a versioned typed contract plus write-time validation for persisted execution metrics run summaries; no aggregation consumers were added.
- What changed: added `src/supervisor/execution-metrics-schema.ts` as the checked-in contract for run summaries, updated `src/supervisor/execution-metrics-run-summary.ts` to validate artifacts before writing, and added `src/supervisor/execution-metrics-schema.test.ts` to pin the schema version and malformed-timestamp rejection path.
- Current blocker: none
- Next exact step: monitor draft PR #905 for CI and review feedback, then address any follow-up if checks fail or comments land.
- Verification gap: none in the requested scope; full build and focused execution-metrics tests passed after `npm ci`.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/supervisor/execution-metrics-run-summary.ts`, `src/supervisor/execution-metrics-schema.ts`, `src/supervisor/execution-metrics-schema.test.ts`
- Rollback concern: low; the change is isolated to execution metrics summary validation and should only reject malformed summary artifacts that were previously written unchecked.
- Last focused command: `gh pr create --draft --base main --head codex/issue-892 --title "Execution metrics schema: define and validate a versioned run-summary contract" --body "..."`
- Last focused failure: `npx tsx --test src/supervisor/execution-metrics-schema.test.ts` initially failed with `AssertionError [ERR_ASSERTION]: Missing expected rejection` because `syncExecutionMetricsRunSummary` wrote malformed timestamps without validation.
- Last focused commands:
```bash
sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-892/AGENTS.generated.md
sed -n '1,260p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-892/context-index.md
sed -n '1,260p' .codex-supervisor/issue-journal.md
git status --short
git branch --show-current && git rev-parse HEAD
rg -n "execution metrics|run summary|run-summary|schema version|schemaVersion|summary" src test . --glob '!node_modules'
rg --files src | rg 'execution|metrics|summary'
sed -n '1,260p' src/supervisor/execution-metrics-run-summary.ts
sed -n '1,520p' src/supervisor/execution-metrics-run-summary.test.ts
sed -n '1,260p' src/supervisor/replay-corpus-validation.ts
sed -n '1,220p' src/core/utils.ts
ls src/supervisor | sed -n '1,200p'
rg -n "validate.*schema|schema contract|versioned schema|validate.*summary" src/supervisor src
sed -n '1,220p' src/committed-guardrails.ts
sed -n '140,240p' src/committed-guardrails.test.ts
apply_patch
npx tsx --test src/supervisor/execution-metrics-schema.test.ts
apply_patch
npx tsx --test src/supervisor/execution-metrics-schema.test.ts
npx tsx --test src/supervisor/execution-metrics-run-summary.test.ts
npm ci
npm run build
git add .codex-supervisor/issue-journal.md src/supervisor/execution-metrics-run-summary.ts src/supervisor/execution-metrics-schema.ts src/supervisor/execution-metrics-schema.test.ts
git commit -m "Validate execution metrics run summaries"
git push -u origin codex/issue-892
gh pr create --draft --base main --head codex/issue-892 --title "Execution metrics schema: define and validate a versioned run-summary contract" --body "..."
git diff -- src/supervisor/execution-metrics-run-summary.ts src/supervisor/execution-metrics-schema.ts src/supervisor/execution-metrics-schema.test.ts
date -u +%Y-%m-%dT%H:%M:%SZ
apply_patch
```
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
