# Issue #911: Execution metrics bug: keep run-summary validation from breaking legitimate terminal paths

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/911
- Branch: codex/issue-911
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: draft_pr
- Attempt count: 2 (implementation=2, repair=0)
- Last head SHA: 6c1bd02fbdb6149371077ce03ea0433a8adcce63
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-23T22:37:08Z

## Latest Codex Summary
Normalized execution-metrics summary assembly so `finishedAt` now tracks the latest legitimate terminal observation instead of assuming the record timestamp is always last. That keeps run-summary validation from breaking merged-PR, closed-PR, and local-CI-blocked terminal paths, and it keeps metrics persistence observational-only instead of rerouting control flow into unexpected-failure recovery.

Added focused regression coverage in [src/supervisor/execution-metrics-failure-recovery.test.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-911/src/supervisor/execution-metrics-failure-recovery.test.ts) and updated the issue journal in [.codex-supervisor/issue-journal.md](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-911/.codex-supervisor/issue-journal.md). The implementation change is in [src/supervisor/execution-metrics-lifecycle.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-911/src/supervisor/execution-metrics-lifecycle.ts). Commit: `6c1bd02fbdb6149371077ce03ea0433a8adcce63`.

Summary: Normalized execution-metrics `finishedAt` to include later failure/recovery observations, added focused regression coverage, updated the issue journal, committed the fix, pushed `codex/issue-911`, and opened draft PR #921.
State hint: pr_open
Blocked reason: none
Tests: `npx tsx --test src/supervisor/execution-metrics-failure-recovery.test.ts src/run-once-issue-preparation.test.ts src/run-once-turn-execution.test.ts src/supervisor/execution-metrics-schema.test.ts`; `npx tsx --test src/run-once-issue-preparation.test.ts src/run-once-turn-execution.test.ts src/supervisor/execution-metrics-run-summary.test.ts src/supervisor/execution-metrics-schema.test.ts`; `npm run build`
Next action: monitor draft PR #921 and address CI or review feedback on `codex/issue-911`
Failure signature: none

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: execution-metrics summaries should treat terminal `updated_at` as a lower bound, not a hard upper bound, because legitimate terminal transitions can record failure or recovery observations slightly later than the record timestamp.
- What changed: updated `src/supervisor/execution-metrics-lifecycle.ts` so the run-summary artifact `finishedAt` becomes the latest of the terminal record timestamp, `failureMetrics.lastOccurredAt`, and `recoveryMetrics.lastRecoveredAt`; added regression coverage in `src/supervisor/execution-metrics-failure-recovery.test.ts` for the late-failure/late-recovery case; committed the fix as `6c1bd02`, pushed branch `codex/issue-911`, and opened draft PR #921 (`https://github.com/TommyKammy/codex-supervisor/pull/921`).
- Current blocker: none
- Next exact step: monitor draft PR #921 for CI and review feedback, then address any follow-up on top of `fb1ef9d7dc3d30f13897420e03d8d902a523cfaf`.
- Verification gap: no known local gap in the targeted terminal-path regressions; broader execution-metrics aggregation/reporting coverage was not rerun beyond the prescribed issue checks and the focused lifecycle unit coverage.
- Files touched: `src/supervisor/execution-metrics-lifecycle.ts`, `src/supervisor/execution-metrics-failure-recovery.test.ts`, `.codex-supervisor/issue-journal.md`
- Rollback concern: low; the change only broadens the summary artifact timestamp envelope so validation reflects legitimate terminal observations and cannot redirect supervisor control flow.
- Last focused command: `npx tsx --test src/run-once-issue-preparation.test.ts src/run-once-turn-execution.test.ts src/supervisor/execution-metrics-run-summary.test.ts src/supervisor/execution-metrics-schema.test.ts`
- Last focused failure: initial `gh pr create` invocation printed `/bin/bash: line 1: finishedAt: command not found` because shell backticks in the PR body triggered command substitution, but the PR creation still succeeded as draft PR #921; the code fix itself has no remaining known local failure.
- Last focused commands:
```bash
sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-911/AGENTS.generated.md
sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-911/context-index.md
sed -n '1,260p' .codex-supervisor/issue-journal.md
git status --short
git branch --show-current
rg -n "run-summary|executionMetricsRunSummary|terminal.*path|closed|merged|local ci|local-CI|unexpected-failure|metrics validation|execution metrics" src
sed -n '1,260p' src/supervisor/execution-metrics-run-summary.ts
sed -n '1,260p' src/supervisor/execution-metrics-schema.ts
sed -n '240,420p' src/supervisor/execution-metrics-run-summary.test.ts
sed -n '430,620p' src/run-once-issue-preparation.test.ts
sed -n '360,520p' src/run-once-turn-execution.test.ts
sed -n '1,260p' src/supervisor/execution-metrics-lifecycle.ts
npx tsx --test src/supervisor/execution-metrics-run-summary.test.ts
npx tsx --test src/run-once-issue-preparation.test.ts src/run-once-turn-execution.test.ts src/supervisor/execution-metrics-schema.test.ts
sed -n '300,430p' src/supervisor/execution-metrics-schema.ts
sed -n '300,380p' src/run-once-turn-execution.test.ts
rg -n "buildCodexFailureContext\(|updated_at: now\(|updated_at:" src | sed -n '1,200p'
rg -n "function buildRecoveryEvent|const buildRecoveryEvent|buildRecoveryEvent\(" src | sed -n '1,120p'
apply_patch
apply_patch
npx tsx --test src/supervisor/execution-metrics-failure-recovery.test.ts src/run-once-issue-preparation.test.ts src/run-once-turn-execution.test.ts src/supervisor/execution-metrics-schema.test.ts
npm run build
test -d node_modules && echo present || echo missing
sed -n '1,220p' package.json
ls | rg 'package-lock.json|pnpm-lock.yaml|yarn.lock'
npm ci
npx tsx --test src/run-once-issue-preparation.test.ts src/run-once-turn-execution.test.ts src/supervisor/execution-metrics-run-summary.test.ts src/supervisor/execution-metrics-schema.test.ts
npm run build
date -u +"%Y-%m-%dT%H:%M:%SZ"
git add .codex-supervisor/issue-journal.md src/supervisor/execution-metrics-failure-recovery.test.ts src/supervisor/execution-metrics-lifecycle.ts
git commit -m "Normalize execution metrics terminal timestamps"
git rev-parse HEAD
git add .codex-supervisor/issue-journal.md
git commit -m "Update issue 911 journal handoff"
git push -u origin codex/issue-911
gh pr create --draft --base main --head codex/issue-911 --title "Keep execution metrics validation from breaking legitimate terminal paths" --body ...
gh pr view --json number,state,isDraft,headRefName,baseRefName,url,title
```
### Scratchpad
- Leave `.codex-supervisor/replay/` untracked; it is local replay output, not part of the fix.
