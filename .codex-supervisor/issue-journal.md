# Issue #876: Operator replay summary: retain recent anomaly context beyond the live timeline

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/876
- Branch: codex/issue-876
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: repairing_ci
- Attempt count: 2 (implementation=1, repair=1)
- Last head SHA: a4a28c1923b21abbb1200dc6e8f0ab42da73a6be
- Blocked reason: none
- Last failure signature: build (ubuntu-latest):fail|build (macos-latest):fail
- Repeated failure signature count: 2
- Updated at: 2026-03-23T11:59:37.035Z

## Latest Codex Summary
Implemented the replay-summary fix on `codex/issue-876`: decision-cycle snapshots now retain a compact `operatorSummary` built from the existing operator activity context, and replay output prints the captured `latest_recovery`, `retry_summary`, and `recovery_loop_summary` lines so repeated anomaly and phase-churn context survives past the live timeline. I added focused coverage in the snapshot and replay tests for both persistence and operator-facing output.

Committed as `970f50e` plus journal sync `a4a28c1`, pushed the branch, and opened draft PR `#889`: https://github.com/TommyKammy/codex-supervisor/pull/889. Focused local verification passed; GitHub currently shows `build (ubuntu-latest)` and `build (macos-latest)` pending. The only remaining local dirt is the untracked `.codex-supervisor/replay/` artifact directory.

Summary: Retained operator-facing anomaly summaries in replay snapshots/output, added focused tests, pushed `codex/issue-876`, and opened draft PR `#889`.
State hint: waiting_ci
Blocked reason: none
Tests: `npx tsx --test src/supervisor/supervisor-cycle-snapshot.test.ts src/supervisor/supervisor-cycle-replay.test.ts`
Failure signature: none
Next action: Monitor PR `#889` check run `23435772583` and respond only if CI or review reports a regression.

## Active Failure Context
- Category: checks
- Summary: PR #889 has failing checks.
- Command or source: gh pr checks
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/889
- Details:
  - build (ubuntu-latest) (fail/FAILURE) https://github.com/TommyKammy/codex-supervisor/actions/runs/23435772583/job/68173334875
  - build (macos-latest) (fail/FAILURE) https://github.com/TommyKammy/codex-supervisor/actions/runs/23435772583/job/68173334854

## Codex Working Notes
### Current Handoff
- Hypothesis: the CI regression is a replay-corpus schema-compatibility gap, not a problem with the operator-summary feature itself; older replay-corpus snapshots and an in-repo promotion fixture still assumed `SupervisorCycleDecisionSnapshot` had no `operatorSummary`.
- What changed: backfilled missing `operatorSummary` values to `null` during replay-corpus input validation so older stored snapshots still load, added `operatorSummary: null` to the typed promotion fixture, and added a regression test covering legacy snapshot loading.
- Current blocker: none
- Next exact step: commit the replay-corpus compatibility repair, push `codex/issue-876`, and monitor the rerun of draft PR `#889` checks.
- Verification gap: local `npm run build` and focused replay-corpus/replay tests now pass; CI has not yet rerun on the repaired commit, so GitHub still reflects the pre-fix failure.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/supervisor/replay-corpus-loading.test.ts`, `src/supervisor/replay-corpus-promotion.test.ts`, `src/supervisor/replay-corpus-validation.ts`
- Rollback concern: low; the repair is compatibility-only for replay-corpus snapshot loading and does not change supervisor decision evaluation.
- Last focused command: `npx tsx --test src/supervisor/replay-corpus-loading.test.ts src/supervisor/replay-corpus-promotion.test.ts src/supervisor/supervisor-cycle-snapshot.test.ts src/supervisor/supervisor-cycle-replay.test.ts`
- Last focused failure: `npm run build` matched CI and failed with `TS2741` because `src/supervisor/replay-corpus-promotion.test.ts` and `src/supervisor/replay-corpus-validation.ts` constructed `SupervisorCycleDecisionSnapshot` values without the new required `operatorSummary` property.
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
git add .codex-supervisor/issue-journal.md src/supervisor/supervisor-cycle-snapshot.ts src/supervisor/supervisor-cycle-replay.ts src/supervisor/supervisor-cycle-snapshot.test.ts src/supervisor/supervisor-cycle-replay.test.ts
git commit -m "Retain operator replay anomaly summaries"
git rev-parse HEAD
git push -u origin codex/issue-876
gh pr create --draft --base main --head codex/issue-876 --title "Retain operator replay anomaly summaries" --body ...
npm ci
gh pr checks 889
gh run view 23435772583 --log-failed
npm run build
sed -n '1,220p' src/supervisor/replay-corpus-promotion.test.ts
sed -n '500,620p' src/supervisor/replay-corpus-validation.ts
sed -n '1,220p' src/supervisor/replay-corpus-loading.test.ts
apply_patch
npx tsx --test src/supervisor/replay-corpus-loading.test.ts src/supervisor/replay-corpus-promotion.test.ts src/supervisor/supervisor-cycle-snapshot.test.ts src/supervisor/supervisor-cycle-replay.test.ts
```
### Scratchpad
- 2026-03-23T12:02:26Z: reproduced PR `#889` build failures from run `23435772583` via `gh run view --log-failed`; both jobs died in `npm run build` with `TS2741` because replay-corpus fixtures/builders were missing `operatorSummary`. Added replay-corpus compatibility backfill plus a legacy-snapshot regression test, then passed local `npm run build` and `npx tsx --test src/supervisor/replay-corpus-loading.test.ts src/supervisor/replay-corpus-promotion.test.ts src/supervisor/supervisor-cycle-snapshot.test.ts src/supervisor/supervisor-cycle-replay.test.ts`.
- 2026-03-23T11:15:43Z: sanitized `.codex-supervisor/issue-journal.md` to remove absolute local paths from the summary, stored review context, and focused command log; no code behavior changed, so no verification rerun was needed for this review-only edit.
- 2026-03-23T10:45:19Z: committed `4ee38a6`, pushed `codex/issue-875`, and opened draft PR `#888` after the focused operator timeline verification passed.
- 2026-03-23T10:43:22Z: reproduced the WebUI timeline gap with a new requeue/active-issue wording regression, then passed `npx tsx --test src/backend/webui-dashboard-browser-logic.test.ts src/backend/webui-dashboard.test.ts src/backend/supervisor-http-server.test.ts` after switching timeline cards to typed command summaries and humanized follow-up event summaries.
- 2026-03-22T21:15:08Z: pushed `codex/issue-846` and opened draft PR `#856`; GitHub currently reports `mergeStateStatus=UNSTABLE`, so the next turn should inspect CI/check runs and address any failures or review feedback.
- 2026-03-22T21:14:15Z: confirmed there was no existing PR for `codex/issue-846`; next step is to push the branch and open a draft PR with commit `c4e2a04`.
- 2026-03-22T21:02:11Z: reproduced the issue with a new shell-structure regression, then passed the focused verification command after moving all dashboard panels onto a shared shell helper with a reserved drag slot and shared subtitle/meta/action lanes.
- 2026-03-22T20:06:27Z: committed the typed dashboard panel layout work as `a6f6ea0`, pushed `codex/issue-845`, and opened draft PR `#855` at https://github.com/TommyKammy/codex-supervisor/pull/855.
- 2026-03-22T20:04:56Z: added typed dashboard panel ids, registry, default layout state, and normalization in `src/backend/webui-dashboard-panel-layout.ts`, then switched `src/backend/webui-dashboard-page.ts` to render from the registry so DOM order is driven by typed layout data rather than duplicated markup order.
- 2026-03-22T20:04:56Z: added focused regressions in `src/backend/webui-dashboard-browser-logic.test.ts` and `src/backend/webui-dashboard.test.ts`; `npx tsx --test src/backend/webui-dashboard-browser-logic.test.ts src/backend/webui-dashboard.test.ts` passed twice on the local diff.
