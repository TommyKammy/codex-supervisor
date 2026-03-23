# Issue #891: Execution metrics foundation: persist structured terminal run summaries

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/891
- Branch: codex/issue-891
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: fcb6de8a5554a9c48e8f7ece4ad2f0bfd52f62a3
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-23T16:22:59.743Z

## Latest Codex Summary
- None yet.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: terminal issue outcomes were already persisted in state/journal flow, but codex-supervisor never wrote a machine-readable per-run summary artifact, so later metrics work had no stable execution-summary input.
- What changed: added `src/supervisor/execution-metrics-run-summary.ts` plus focused regressions in `src/supervisor/execution-metrics-run-summary.test.ts`; wired terminal summary writes into preparation-time terminal exits (`done` on merged PR convergence and `blocked` on closed PR/local-CI gates), turn-time terminal exits (`blocked`/`failed` via failure helpers and local-CI gate), unexpected-turn recovery failures, repeated-failure termination, and post-turn merge completion.
- Current blocker: none
- Next exact step: review the terminal-summary diff, commit it on `codex/issue-891`, and open or update the draft PR if needed.
- Verification gap: none on the requested verification surface after restoring `node_modules` in this worktree.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/run-once-issue-preparation.ts`, `src/run-once-turn-execution.ts`, `src/supervisor/execution-metrics-run-summary.ts`, `src/supervisor/execution-metrics-run-summary.test.ts`, `src/supervisor/supervisor-failure-helpers.ts`, `src/supervisor/supervisor.ts`, `src/turn-execution-failure-helpers.ts`
- Rollback concern: low; the change is write-only and observational, and reverting it would remove the terminal run summary artifact without affecting scheduling or PR flow.
- Last focused command: `npm run build`
- Last focused failure: `npx tsx --test src/supervisor/execution-metrics-run-summary.test.ts` initially failed with `ENOENT` opening `.codex-supervisor/execution-metrics/run-summary.json` for `done`, `blocked`, and `failed` terminal paths because no summary artifact was written; `npm run build` also failed once with `sh: 1: tsc: not found` until `npm install` restored missing `node_modules`.
- Last focused commands:
```bash
sed -n '1,240p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-891/AGENTS.generated.md
sed -n '1,260p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-891/context-index.md
sed -n '1,260p' .codex-supervisor/issue-journal.md
git status --short
rg -n "execution metrics|run summary|terminal outcome|terminal state|finishedAt|startedAt|blocked|failed|done" src -g '*.ts'
rg --files src | rg 'execution-metrics|metrics|run-summary|summary'
sed -n '1,260p' src/run-once-turn-execution.ts
sed -n '1,260p' src/run-once-turn-execution.test.ts
sed -n '1,260p' src/core/types.ts
sed -n '1,220p' src/turn-execution-test-helpers.ts
sed -n '260,620p' src/run-once-turn-execution.ts
sed -n '1,260p' src/run-once-issue-preparation.ts
sed -n '260,460p' src/run-once-issue-preparation.ts
sed -n '1,240p' src/supervisor/supervisor-cycle-snapshot.ts
sed -n '1,260p' src/supervisor/supervisor-cycle-replay.test.ts
rg -n "startedAt|started_at|run started|start time|attempt started|execution started|selectedAt|active issue" src/supervisor src -g '*.ts'
sed -n '430,520p' src/core/state-store.ts
sed -n '1,220p' src/run-once-issue-preparation.test.ts
sed -n '520,620p' src/run-once-issue-preparation.test.ts
sed -n '1,280p' src/turn-execution-failure-helpers.ts
sed -n '130,220p' src/supervisor/supervisor-failure-helpers.ts
apply_patch
npx tsx --test src/supervisor/execution-metrics-run-summary.test.ts
apply_patch
npx tsx --test src/supervisor/execution-metrics-run-summary.test.ts
cat package.json
npm ls typescript --depth=0
npm install
npm run build
npx tsx --test src/supervisor/execution-metrics-run-summary.test.ts
find .codex-supervisor/replay -maxdepth 3 -type f | sort
node -e "const fs=require('node:fs'); fs.rmSync('.codex-supervisor/replay', {recursive:true, force:true});"
date -u +%Y-%m-%dT%H:%M:%SZ
```
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
