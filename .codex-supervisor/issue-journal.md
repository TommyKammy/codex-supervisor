# Issue #1077: Replace setup reconnect real sleeps with deterministic timer control

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1077
- Branch: codex/issue-1077
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 7a1261897a3e30640fbe6735c87fe32a1ab0cb06
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-26T15:21:19Z

## Latest Codex Summary
- Replaced the setup-shell reconnect test's real 75 ms sleeps with deterministic harness timer advancement, pushed `codex/issue-1077`, and opened draft PR #1084 after focused backend WebUI verification.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the only product-risky behavior here is test harness timing. The reconnect flow can stay unchanged if the setup-page harness exposes deterministic timer control for the poll loop.
- What changed: added a small manual timer controller to `src/backend/webui-dashboard.test.ts`, wired `createSetupHarness()` to use it, exposed `harness.advanceTime(ms)`, and updated the setup reconnect test to advance 50 ms polling intervals instead of sleeping in wall-clock time.
- Current blocker: none.
- Next exact step: watch draft PR #1084 CI and only widen verification if review or CI finds another timing-dependent WebUI test path.
- Verification gap: full `npm test` has not been run; focused backend WebUI reconnect and setup/server coverage are green.
- Files touched: `.codex-supervisor/issue-journal.md`; `src/backend/webui-dashboard.test.ts`.
- Rollback concern: low. The change is test-only and limited to how the setup harness schedules reconnect polling.
- Last focused command: `gh pr create --draft --base main --head codex/issue-1077 --title "Issue #1077: replace setup reconnect sleeps with timer control" --body ...`
- What changed this turn: reread the required memory files and journal, traced the setup reconnect test and the setup-page browser poll loop, reproduced that the focused reconnect test still depended on two real `setTimeout(..., 75)` waits, added a manual timer controller to the dashboard/setup HTML harness, updated the reconnect test to advance deterministic timer state across the `reconnecting -> unavailable -> ready` sequence, reran focused backend WebUI verification, committed the change as `7a12618`, pushed `codex/issue-1077`, and opened draft PR #1084.
- Exact failure reproduced this turn: `src/backend/webui-dashboard.test.ts` used wall-clock sleeps to let the setup reconnect polling loop advance between readiness responses, making the reconnect-state assertions depend on scheduler timing instead of harness-controlled time.
- Commands run this turn: `sed -n '1,220p' <always-read-memory>`; `sed -n '1,260p' <context-index>`; `sed -n '1,260p' .codex-supervisor/issue-journal.md`; `git status --short --branch`; `rg -n "setTimeout\\(.*75|reconnect|reconnecting|unavailable|ready" webui src test .`; `rg --files . | rg "setup-shell|dashboard|harness|timer|vitest|playwright|webui"`; `rg -n "setTimeout\\(|75\\)|reconnect|reconnecting|unavailable|ready|advance.*timer|clock|fake.*timer" src/backend`; `sed -n '1,260p' src/backend/webui-dashboard.test.ts`; `sed -n '1,260p' src/backend/restartable-webui-shell-service.test.ts`; `sed -n '2280,2875p' src/backend/webui-dashboard.test.ts`; `sed -n '260,520p' src/backend/webui-dashboard.test.ts`; `sed -n '1,220p' src/backend/webui-setup-browser-script.ts`; `sed -n '220,430p' src/backend/webui-setup-browser-script.ts`; `node --test src/backend/webui-dashboard.test.ts`; `npx tsx --test src/backend/webui-dashboard.test.ts`; `rg -n "create(Html|Setup|Dashboard)Harness|flush\\(|setTimeout\\(|clearTimeout\\(" src/backend/webui-dashboard.test.ts`; `apply_patch ...`; `npx tsx --test src/backend/webui-dashboard.test.ts`; `rg -n "await new Promise\\(\\(resolve\\) => setTimeout\\(resolve, 75\\)\\)" src/backend/webui-dashboard.test.ts src/backend`; `git diff -- src/backend/webui-dashboard.test.ts`; `git rev-parse HEAD`; `date -u +"%Y-%m-%dT%H:%M:%SZ"`; `npx tsx --test src/backend/restartable-webui-shell-service.test.ts src/backend/supervisor-http-server.test.ts`; `git add .codex-supervisor/issue-journal.md src/backend/webui-dashboard.test.ts`; `git commit -m "Replace setup reconnect sleeps with timer control"`; `git push -u origin codex/issue-1077`; `gh pr view --json number,url,isDraft,headRefName,baseRefName,state`; `gh pr create --draft --base main --head codex/issue-1077 --title "Issue #1077: replace setup reconnect sleeps with timer control" --body ...`.
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
