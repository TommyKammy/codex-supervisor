# Issue #861: Stale recovery guard: preserve stale no-PR convergence tracking across successful no-PR turns

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/861
- Branch: codex/issue-861
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 2d9a696082ea37977cb1c6fc960ea2184aeaa6e0
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-23T00:59:48Z

## Latest Codex Summary
- Preserved stale stabilizing no-PR convergence tracking across successful no-PR turns so the repeat guard now survives the stale cleanup -> no-PR turn -> stale cleanup loop and converges at the existing repeat limit.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the stale recovery loop was resetting in the generic successful no-PR turn path after recovery had already incremented the `stale-stabilizing-no-pr-recovery-loop` signature.
- What changed: added a focused `executeCodexTurnPhase` regression for the successful no-PR reset, introduced a narrow stale-no-PR preservation helper in `src/no-pull-request-state.ts`, preserved that signature/context/count in `src/run-once-turn-execution.ts` only when the turn still ends `stabilizing` with no PR, and added an orchestration regression that covers stale cleanup -> successful no-PR turn -> stale cleanup convergence.
- Current blocker: none
- Next exact step: review the final diff, commit the stale no-PR guard fix on `codex/issue-861`, and open or update the draft PR if one is still missing.
- Verification gap: none in the focused regression surface; the issue verification command passed locally after the fix.
- Files touched: `src/no-pull-request-state.ts`, `src/no-pull-request-state.test.ts`, `src/recovery-reconciliation.ts`, `src/run-once-turn-execution.ts`, `src/run-once-turn-execution.test.ts`, `src/supervisor/supervisor-execution-orchestration.test.ts`, `.codex-supervisor/issue-journal.md`
- Rollback concern: low; the behavior change is isolated to successful no-PR turns that remain in stale stabilizing recovery, while unrelated successful flows still clear generic failure signatures.
- Last focused command: `npx tsx --test src/run-once-turn-execution.test.ts src/supervisor/supervisor-recovery-reconciliation.test.ts src/supervisor/supervisor-execution-orchestration.test.ts`
- Last focused failure: `stale-stabilizing-no-pr-recovery-loop-reset`
- Last focused commands:
```bash
sed -n '1,220p' "<local-memory>/issue-861/AGENTS.generated.md"
sed -n '1,220p' "<local-memory>/issue-861/context-index.md"
sed -n '1,260p' .codex-supervisor/issue-journal.md
git status --short --branch
rg -n "stale|no-PR|stabilizing|convergence|failure signature" src
sed -n '1088,1185p' src/recovery-reconciliation.ts
sed -n '320,520p' src/run-once-turn-execution.ts
npx tsx --test src/run-once-turn-execution.test.ts
npx tsx --test src/no-pull-request-state.test.ts src/run-once-turn-execution.test.ts src/supervisor/supervisor-recovery-reconciliation.test.ts
npx tsx --test src/run-once-turn-execution.test.ts src/supervisor/supervisor-recovery-reconciliation.test.ts src/supervisor/supervisor-execution-orchestration.test.ts
date -u +%Y-%m-%dT%H:%M:%SZ
```
### Scratchpad
- 2026-03-23T00:59:48Z: reproduced the bug with a focused `executeCodexTurnPhase` regression showing a successful no-PR turn cleared `stale-stabilizing-no-pr-recovery-loop`, then fixed the post-turn no-PR success path to preserve only that stale stabilizing signature/context/count when the issue still ends `stabilizing` without a PR and verified the full stale cleanup -> no-PR turn -> stale cleanup sequence with the targeted orchestration suite.
- 2026-03-23T00:29:58Z: confirmed the remaining CodeRabbit finding is valid because the durable journal still contained workstation-local absolute paths, then rewrote the summary/review context/command history locally to use repo-relative references and `<local-memory>` placeholders before preparing the review-only push.
- 2026-03-22T22:21:32Z: reran `npx tsx --test src/backend/webui-dashboard-browser-logic.test.ts src/backend/webui-dashboard.test.ts`, pushed `codex/issue-848`, and opened draft PR `#858` for the drag-reorder checkpoint.
- 2026-03-22T22:09:23Z: reproduced the drag-reorder gap with a pure browser-logic regression, then added draggable panel handles, browser-only DOM reorder state, and a runtime dashboard drag test; `npx tsx --test src/backend/webui-dashboard-browser-logic.test.ts src/backend/webui-dashboard.test.ts` passed.
- 2026-03-22T21:40:05Z: pushed `codex/issue-847` and opened draft PR `#857` for the verified dashboard refresh checkpoint.
- 2026-03-22T21:40:05Z: reproduced the visual-refresh gap with a new hero-and-section framing regression, refreshed the dashboard page chrome/CSS to add labeled lanes and flatter surfaces, and passed `npx tsx --test src/backend/webui-dashboard.test.ts src/backend/webui-dashboard-browser-logic.test.ts`.
- 2026-03-22T21:15:08Z: pushed `codex/issue-846` and opened draft PR `#856`; GitHub currently reports `mergeStateStatus=UNSTABLE`, so the next turn should inspect CI/check runs and address any failures or review feedback.
- 2026-03-22T21:14:15Z: confirmed there was no existing PR for `codex/issue-846`; next step is to push the branch and open a draft PR with commit `c4e2a04`.
- 2026-03-22T21:02:11Z: reproduced the issue with a new shell-structure regression, then passed the focused verification command after moving all dashboard panels onto a shared shell helper with a reserved drag slot and shared subtitle/meta/action lanes.
- 2026-03-22T20:06:27Z: committed the typed dashboard panel layout work as `a6f6ea0`, pushed `codex/issue-845`, and opened draft PR `#855` at https://github.com/TommyKammy/codex-supervisor/pull/855.
- 2026-03-22T20:04:56Z: added typed dashboard panel ids, registry, default layout state, and normalization in `src/backend/webui-dashboard-panel-layout.ts`, then switched `src/backend/webui-dashboard-page.ts` to render from the registry so DOM order is driven by typed layout data rather than duplicated markup order.
- 2026-03-22T20:04:56Z: added focused regressions in `src/backend/webui-dashboard-browser-logic.test.ts` and `src/backend/webui-dashboard.test.ts`; `npx tsx --test src/backend/webui-dashboard-browser-logic.test.ts src/backend/webui-dashboard.test.ts` passed twice on the local diff.
