# Issue #876: Operator replay summary: retain recent anomaly context beyond the live timeline

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/876
- Branch: codex/issue-876
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 4330f936be92934b5663e021702def542a9f08e4
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-23T11:45:40Z

## Latest Codex Summary
- Captured operator-facing replay summaries directly inside the decision snapshot and replay formatter so repeated anomaly and phase-churn context remains visible after the live timeline advances.

## Active Failure Context
- Failure reproduced as a coverage gap: replay snapshots retained low-level failure counters and signatures, but dropped the compact operator activity summary that surfaces repeated failure signatures, recovery loops, and recent recovery-driven phase changes.

## Codex Working Notes
### Current Handoff
- Hypothesis: persisting a compact operator summary alongside the replay snapshot is the minimal fix because the existing operator activity DTOs already encode retry loops, repeated anomalies, and recovery-driven phase churn cleanly.
- What changed: added `operatorSummary` to the decision-cycle snapshot, populated it from the existing operator activity context helpers, and taught replay formatting to print the captured `latest_recovery`, `retry_summary`, and `recovery_loop_summary` lines when present.
- Current blocker: none
- Next exact step: commit the focused replay-summary patch, then check whether `codex/issue-876` already has a PR; if not, push and open a draft PR with the focused verification attached.
- Verification gap: focused replay snapshot and replay formatter tests pass locally; broader repo verification has not been rerun because the change is isolated to replay snapshot formatting.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/supervisor/supervisor-cycle-snapshot.ts`, `src/supervisor/supervisor-cycle-replay.ts`, `src/supervisor/supervisor-cycle-snapshot.test.ts`, `src/supervisor/supervisor-cycle-replay.test.ts`
- Rollback concern: low; the patch only adds a derived operator-summary surface on top of existing replay artifacts and does not alter replay decision evaluation.
- Last focused command: `npx tsx --test src/supervisor/supervisor-cycle-snapshot.test.ts src/supervisor/supervisor-cycle-replay.test.ts`
- Last focused failure: replay artifacts preserved raw anomaly counters but not the compact operator-facing summary lines, so recent loop context disappeared once the live status moved on.
- Last focused commands:
```bash
sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-876/AGENTS.generated.md
sed -n '1,260p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-876/context-index.md
sed -n '1,320p' .codex-supervisor/issue-journal.md
git status --short --branch
rg -n "decision-cycle-snapshot|formatSupervisorCycleReplay|replay artifact|recent history|history summary|summary surface" src -g '*.ts'
find .codex-supervisor/replay -maxdepth 3 -type f | sort
sed -n '1,260p' src/supervisor/supervisor-cycle-snapshot.test.ts
sed -n '1,320p' src/supervisor/supervisor-cycle-replay.test.ts
sed -n '1,320p' src/supervisor/supervisor-cycle-snapshot.ts
sed -n '1,320p' src/supervisor/supervisor-cycle-replay.ts
sed -n '1,260p' src/supervisor/supervisor-operator-activity-context.ts
sed -n '260,460p' src/supervisor/supervisor-operator-activity-context.ts
sed -n '1,220p' src/supervisor/supervisor-detailed-status-assembly.ts
npx tsx --test src/supervisor/supervisor-cycle-snapshot.test.ts src/supervisor/supervisor-cycle-replay.test.ts src/cli/replay-handlers.test.ts
apply_patch
npx tsx --test src/supervisor/supervisor-cycle-snapshot.test.ts src/supervisor/supervisor-cycle-replay.test.ts
git diff -- src/supervisor/supervisor-cycle-snapshot.ts src/supervisor/supervisor-cycle-replay.ts src/supervisor/supervisor-cycle-snapshot.test.ts src/supervisor/supervisor-cycle-replay.test.ts
date -u +%Y-%m-%dT%H:%M:%SZ
```
### Scratchpad
- 2026-03-23T11:45:40Z: reproduced the gap as missing replay-summary coverage rather than a functional replay mismatch, added focused tests proving the snapshot and formatter now retain `latest_recovery`, `retry_summary`, and `recovery_loop_summary`, and passed `npx tsx --test src/supervisor/supervisor-cycle-snapshot.test.ts src/supervisor/supervisor-cycle-replay.test.ts`.
- 2026-03-23T11:00:34Z: committed `690022a` to sync the issue journal, pushed `codex/issue-875`, and observed GitHub start a newer PR `#888` rerun as Actions run `23434005312` with both `build` jobs pending.
- 2026-03-23T10:59:32Z: committed `82e6b50` for the TS18049 narrowing fix, pushed `codex/issue-875`, and confirmed PR `#888` reran as GitHub Actions run `23433971857` with both `build` jobs pending.
- 2026-03-23T10:58:18Z: reproduced the failing CI build from GitHub Actions run `23433409449`, fixed TS18049 in `describeTimelineCommandResult` by binding `issueNumber = result?.issueNumber`, then passed `npm run build` and `npx tsx --test src/backend/webui-dashboard-browser-logic.test.ts src/backend/webui-dashboard.test.ts src/backend/supervisor-http-server.test.ts`.
- 2026-03-23T11:15:43Z: sanitized `.codex-supervisor/issue-journal.md` to remove absolute local paths from the summary, stored review context, and focused command log; no code behavior changed, so no verification rerun was needed for this review-only edit.
- 2026-03-23T10:45:19Z: committed `4ee38a6`, pushed `codex/issue-875`, and opened draft PR `#888` after the focused operator timeline verification passed.
- 2026-03-23T10:43:22Z: reproduced the WebUI timeline gap with a new requeue/active-issue wording regression, then passed `npx tsx --test src/backend/webui-dashboard-browser-logic.test.ts src/backend/webui-dashboard.test.ts src/backend/supervisor-http-server.test.ts` after switching timeline cards to typed command summaries and humanized follow-up event summaries.
- 2026-03-22T21:15:08Z: pushed `codex/issue-846` and opened draft PR `#856`; GitHub currently reports `mergeStateStatus=UNSTABLE`, so the next turn should inspect CI/check runs and address any failures or review feedback.
- 2026-03-22T21:14:15Z: confirmed there was no existing PR for `codex/issue-846`; next step is to push the branch and open a draft PR with commit `c4e2a04`.
- 2026-03-22T21:02:11Z: reproduced the issue with a new shell-structure regression, then passed the focused verification command after moving all dashboard panels onto a shared shell helper with a reserved drag slot and shared subtitle/meta/action lanes.
- 2026-03-22T20:06:27Z: committed the typed dashboard panel layout work as `a6f6ea0`, pushed `codex/issue-845`, and opened draft PR `#855` at https://github.com/TommyKammy/codex-supervisor/pull/855.
- 2026-03-22T20:04:56Z: added typed dashboard panel ids, registry, default layout state, and normalization in `src/backend/webui-dashboard-panel-layout.ts`, then switched `src/backend/webui-dashboard-page.ts` to render from the registry so DOM order is driven by typed layout data rather than duplicated markup order.
- 2026-03-22T20:04:56Z: added focused regressions in `src/backend/webui-dashboard-browser-logic.test.ts` and `src/backend/webui-dashboard.test.ts`; `npx tsx --test src/backend/webui-dashboard-browser-logic.test.ts src/backend/webui-dashboard.test.ts` passed twice on the local diff.
