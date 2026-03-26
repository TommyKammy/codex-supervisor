# Issue #1077: Replace setup reconnect real sleeps with deterministic timer control

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1077
- Branch: codex/issue-1077
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: b3127d55a8b0077464665bb511c1f14e9e0d703a
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-26T15:19:54Z

## Latest Codex Summary
- Replaced the setup-shell reconnect test's real 75 ms sleeps with deterministic harness timer advancement and verified the reconnect state transitions under focused backend WebUI tests.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the only product-risky behavior here is test harness timing. The reconnect flow can stay unchanged if the setup-page harness exposes deterministic timer control for the poll loop.
- What changed: added a small manual timer controller to `src/backend/webui-dashboard.test.ts`, wired `createSetupHarness()` to use it, exposed `harness.advanceTime(ms)`, and updated the setup reconnect test to advance 50 ms polling intervals instead of sleeping in wall-clock time.
- Current blocker: none.
- Next exact step: commit the deterministic timer test harness update, push `codex/issue-1077`, and open or update the draft PR if one does not already exist.
- Verification gap: full `npm test` has not been run; focused backend WebUI reconnect and setup/server coverage are green.
- Files touched: `.codex-supervisor/issue-journal.md`; `src/backend/webui-dashboard.test.ts`.
- Rollback concern: low. The change is test-only and limited to how the setup harness schedules reconnect polling.
- Last focused command: `npx tsx --test src/backend/restartable-webui-shell-service.test.ts src/backend/supervisor-http-server.test.ts`
- What changed this turn: reread the required memory files and journal, traced the setup reconnect test and the setup-page browser poll loop, reproduced that the focused reconnect test still depended on two real `setTimeout(..., 75)` waits, added a manual timer controller to the dashboard/setup HTML harness, updated the reconnect test to advance deterministic timer state across the `reconnecting -> unavailable -> ready` sequence, and reran focused backend WebUI verification.
- Exact failure reproduced this turn: `src/backend/webui-dashboard.test.ts` used wall-clock sleeps to let the setup reconnect polling loop advance between readiness responses, making the reconnect-state assertions depend on scheduler timing instead of harness-controlled time.
- Commands run this turn: `sed -n '1,220p' <always-read-memory>`; `sed -n '1,260p' <context-index>`; `sed -n '1,260p' .codex-supervisor/issue-journal.md`; `git status --short --branch`; `rg -n "setTimeout\\(.*75|reconnect|reconnecting|unavailable|ready" webui src test .`; `rg --files . | rg "setup-shell|dashboard|harness|timer|vitest|playwright|webui"`; `rg -n "setTimeout\\(|75\\)|reconnect|reconnecting|unavailable|ready|advance.*timer|clock|fake.*timer" src/backend`; `sed -n '1,260p' src/backend/webui-dashboard.test.ts`; `sed -n '1,260p' src/backend/restartable-webui-shell-service.test.ts`; `sed -n '2280,2875p' src/backend/webui-dashboard.test.ts`; `sed -n '260,520p' src/backend/webui-dashboard.test.ts`; `sed -n '1,220p' src/backend/webui-setup-browser-script.ts`; `sed -n '220,430p' src/backend/webui-setup-browser-script.ts`; `node --test src/backend/webui-dashboard.test.ts`; `npx tsx --test src/backend/webui-dashboard.test.ts`; `rg -n "create(Html|Setup|Dashboard)Harness|flush\\(|setTimeout\\(|clearTimeout\\(" src/backend/webui-dashboard.test.ts`; `apply_patch ...`; `npx tsx --test src/backend/webui-dashboard.test.ts`; `rg -n "await new Promise\\(\\(resolve\\) => setTimeout\\(resolve, 75\\)\\)" src/backend/webui-dashboard.test.ts src/backend`; `git diff -- src/backend/webui-dashboard.test.ts`; `git rev-parse HEAD`; `date -u +"%Y-%m-%dT%H:%M:%SZ"`; `npx tsx --test src/backend/restartable-webui-shell-service.test.ts src/backend/supervisor-http-server.test.ts`.
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
