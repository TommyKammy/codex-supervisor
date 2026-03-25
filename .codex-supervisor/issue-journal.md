# Issue #1009: Recovery context durability: preserve recovery events across early interrupted run-once exits

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1009
- Branch: codex/issue-1009
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: implementing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: ea506f56d580e85840388d0103bb0828f6741fc0
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-25T17:18:41Z

## Latest Codex Summary
Added narrow regression coverage for issue #1009 without changing runtime behavior. `src/supervisor/supervisor.test.ts` now proves `runOnce()` keeps carryover recovery context when a restarted cycle exits early before issue execution, and `src/supervisor/supervisor-status-model-supervisor.test.ts` now proves inactive status output still reports the latest durable recovery record. Installed missing local dependencies with `npm ci`, then verified the acceptance test slice, the existing orchestration recovery coverage, and `npm run build`.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: issue #1009’s remaining gap on `main` was not missing runtime persistence, but missing focused acceptance coverage for the early-return path and the inactive status surface that operators use after the restart.
- What changed: added a `runOnce()` regression that restarts once, then exits early from the next cycle, asserting the returned message still includes the carryover recovery log; added an inactive-status regression asserting `buildDetailedStatusModel()` still renders `latest_recovery` when no active issue is running.
- Current blocker: none.
- Next exact step: commit the focused regressions, push `codex/issue-1009`, and open the draft PR for review.
- Verification gap: none after `npx tsx --test src/supervisor/supervisor.test.ts src/supervisor/supervisor-status-model-supervisor.test.ts`, `npx tsx --test src/supervisor/supervisor-execution-orchestration.test.ts`, and `npm run build`.
- Files touched: `src/supervisor/supervisor.test.ts`; `src/supervisor/supervisor-status-model-supervisor.test.ts`; `.codex-supervisor/issue-journal.md`.
- Rollback concern: low; this checkpoint only tightens regression coverage and the issue journal, with no production runtime change.
- Last focused command: `npm run build`
- Exact failure reproduced: before this checkpoint the branch lacked an acceptance-focused regression proving that a carryover recovery event survives a restart followed by an early `runOnce()` exit, and lacked a colocated status-model regression proving the latest durable recovery remains visible when the supervisor is idle.
- Commands run: `sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-1009/AGENTS.generated.md`; `sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-1009/context-index.md`; `sed -n '1,260p' .codex-supervisor/issue-journal.md`; `git status --short --branch`; `git diff -- src/interrupted-turn-marker.ts src/run-once-turn-execution.ts src/recovery-reconciliation.ts src/run-once-turn-execution.test.ts src/supervisor/supervisor-execution-orchestration.test.ts src/supervisor/supervisor-recovery-reconciliation.test.ts .codex-supervisor/issue-journal.md`; `npx tsx --test src/run-once-turn-execution.test.ts src/supervisor/supervisor-execution-orchestration.test.ts src/supervisor/supervisor-recovery-reconciliation.test.ts`; `npm run build`; `git log --oneline --decorate --graph -8`; `gh pr status`; `git branch -vv`; `rg -n "recovery event|recoveryEvents|carry.*recovery|runOnce carries recovery events|recent recovery|recovery context" src -g '!dist'`; `sed -n '1260,1505p' src/supervisor/supervisor.ts`; `sed -n '1,260p' src/supervisor/supervisor-status-model.ts`; `sed -n '300,420p' src/supervisor/supervisor-status-model-supervisor.test.ts`; `sed -n '1288,1388p' src/supervisor/supervisor-execution-orchestration.test.ts`; `sed -n '1,240p' src/run-once-cycle-prelude.ts`; `sed -n '1,240p' src/run-once-issue-preparation.ts`; `rg -n "applyRecoveryEvent|buildRecoveryEvent\\(|last_recovery_reason|last_recovery_at" src/run-once-issue-preparation.ts src/supervisor/supervisor.ts src -g '!dist'`; `sed -n '240,430p' src/run-once-issue-preparation.ts`; `sed -n '620,930p' src/supervisor/supervisor.ts`; `sed -n '1,220p' src/supervisor/supervisor-detailed-status-assembly.ts`; `sed -n '1,240p' src/supervisor/supervisor-status-rendering.ts`; `rg -n "latestRecoveryRecord|latest_recovery" src/supervisor -g '!dist'`; `test -d node_modules && echo present || echo missing`; `cat package.json`; `npm ci`; `npx tsx --test src/supervisor/supervisor.test.ts src/supervisor/supervisor-status-model-supervisor.test.ts`; `npx tsx --test src/supervisor/supervisor-execution-orchestration.test.ts`; `date -u +"%Y-%m-%dT%H:%M:%SZ"`.
- PR status: none yet.
### Scratchpad
- Leave `.codex-supervisor/replay/` untracked; it is local replay output, not part of the fix.
