# Issue #815: WebUI browser confidence: add smoke coverage for read-only and safe-command workflows

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/815
- Branch: codex/issue-815
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 08f9750f71edcbcadb1b531047ecf73f524bd287
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-22T05:02:51.455Z

## Latest Codex Summary
- Reproduced the #815 gap by adding a real browser smoke file and confirming it failed immediately with `Cannot find module 'playwright-core'`, which showed the repo had no browser-level harness wired yet.
- Added `src/backend/webui-dashboard-browser-smoke.test.ts`, a `test:webui-smoke` package script, and `playwright-core` so the dashboard now has browser-level smoke coverage for read-only load and a confirmed safe-command flow against a controlled in-process HTTP fixture.
- Documented the harness expectation in `README.md` and `docs/getting-started.md`, including the `CHROME_BIN` override for CI or nonstandard browser paths.
- Focused verification passed with `npx tsx --test src/backend/webui-dashboard.test.ts src/backend/supervisor-http-server.test.ts`, `npm run test:webui-smoke`, and `npm run build`.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the remaining confidence gap for the WebUI was missing browser-level coverage across the actual HTTP shell, SSE connection, and safe-command button flow; existing VM-based script tests were narrower than the new acceptance criteria.
- What changed: added a Playwright-core-backed smoke test that launches a real headless Chrome/Chromium against `createSupervisorHttpServer()`, covers read-only dashboard load, and exercises the confirmed prune-workspaces command path end to end through the browser UI.
- Current blocker: none
- Next exact step: commit the browser smoke harness changes on `codex/issue-815`, then open or update the draft PR so CI can run the new `npm run test:webui-smoke` command remotely.
- Verification gap: none locally after the focused dashboard/server tests, browser smoke command, and build all passed.
- Files touched: `.codex-supervisor/issue-journal.md`, `README.md`, `docs/getting-started.md`, `package-lock.json`, `package.json`, `src/backend/webui-dashboard-browser-smoke.test.ts`
- Rollback concern: keep the smoke harness fixture-only and browser-binary-driven through `CHROME_BIN` so the suite stays deterministic and does not grow into network-dependent end-to-end coverage.
- Last focused command: `npm run test:webui-smoke`
- Last focused failure: `Cannot find module 'playwright-core'`
- Last focused commands:
```bash
npx tsx --test src/backend/webui-dashboard.test.ts src/backend/supervisor-http-server.test.ts
npx tsx --test src/backend/webui-dashboard-browser-smoke.test.ts
npm install --save-dev playwright-core
npm run test:webui-smoke
npm run build
```
### Scratchpad
- 2026-03-22T00:00:00Z: reproduced #815 with a new browser smoke file; the first run failed with `Cannot find module 'playwright-core'`, confirming the repo had no browser-level dashboard harness wired yet.
- 2026-03-22T00:00:00Z: added `playwright-core`, a `test:webui-smoke` script, and `src/backend/webui-dashboard-browser-smoke.test.ts` to cover read-only dashboard load plus a confirmed prune-workspaces flow against an in-process server fixture.
- 2026-03-22T00:00:00Z: `npm run build` initially failed on the new smoke test because the stub doctor/mutation DTOs did not fully satisfy the repository TypeScript contracts; added `candidateDiscoverySummary`, `previousRecordSnapshot`, and nullable `textContent` handling, then reran successfully.
- 2026-03-22T00:00:00Z: documented the browser harness in `README.md` and `docs/getting-started.md`, including the `CHROME_BIN` override for CI or nonstandard local browser paths.
- 2026-03-22T00:00:00Z: focused verification passed with `npx tsx --test src/backend/webui-dashboard.test.ts src/backend/supervisor-http-server.test.ts`, `npm run test:webui-smoke`, and `npm run build`.
- 2026-03-22T00:00:00Z: updated browser-side safe-command rendering to publish explicit `in_progress`, rejection, and refresh-failure guidance, and added a static operator hint describing serialized command execution.
- 2026-03-22T00:00:00Z: `npm run build` initially failed with `sh: 1: tsc: not found`; `npm ci` restored local dependencies and the rerun passed.
- 2026-03-22T03:28:21Z: focused verification passed with `npx tsx --test src/backend/webui-dashboard-browser-logic.test.ts src/backend/webui-dashboard.test.ts src/backend/supervisor-http-server.test.ts` and `npm run build` after `npm ci` restored `tsc` in this worktree.
- 2026-03-22T00:00:00Z: reproduced missing rejection feedback with a confirm-decline dashboard case for prune workspaces; the browser returned early without a visible command result until declined confirmations were routed through a rejected-command renderer.
- 2026-03-22T00:00:00Z: focused verification passed with `npx tsx --test src/backend/webui-dashboard.test.ts`, `npx tsx --test src/backend/webui-dashboard.test.ts src/backend/supervisor-http-server.test.ts`, `npm ci`, and `npm run build`.
- 2026-03-21T23:43:40Z: reran the focused verification from the stabilizing checkpoint; `npx tsx --test src/backend/webui-dashboard.test.ts src/backend/supervisor-http-server.test.ts` and `npm run build` both passed on `f677ae4`.
- 2026-03-21T23:44:23Z: pushed `codex/issue-802` to origin and opened draft PR #807 (`https://github.com/TommyKammy/codex-supervisor/pull/807`) after the focused verification stayed green.
- 2026-03-21T23:07:19Z: reproduced the current #801 gap with a new dashboard test that expected typed runnable/blocked issues to expose clickable shortcuts for explain and issue-lint without using the manual number field.
- 2026-03-21T23:07:19Z: added a read-only typed issue shortcut strip to the dashboard, deduped across active/runnable/blocked/tracked issue DTOs, and reused the existing `loadIssue()` path for inspection.
- 2026-03-21T23:07:19Z: focused verification passed with `npx tsx --test src/backend/webui-dashboard.test.ts`, `npx tsx --test src/backend/webui-dashboard.test.ts src/backend/supervisor-http-server.test.ts`, and `npm run build` after restoring local dependencies via `npm ci`.
- 2026-03-21T23:07:19Z: committed `9921e48` (`Add typed dashboard issue shortcuts`), pushed `codex/issue-801`, and opened draft PR #806 (`https://github.com/TommyKammy/codex-supervisor/pull/806`).
- 2026-03-22T00:00:00Z: reproduced the issue with a new dashboard harness case that supplied typed tracked/blocked/candidate-discovery data but no legacy readiness lines; the dashboard rendered `No status lines reported.`
- 2026-03-22T00:00:00Z: refactored readiness assembly to emit typed runnable and blocked issue collections alongside the existing line-based summary, and added typed tracked issue DTOs plus typed candidate-discovery summary fields to `statusReport()`.
- 2026-03-22T00:00:00Z: focused verification passed; `npm run build` again needed a local `npm ci` because `tsc` was missing in this worktree.
- 2026-03-22T00:00:00Z: pushed `codex/issue-800` and opened draft PR #805 (`https://github.com/TommyKammy/codex-supervisor/pull/805`).
- 2026-03-21T22:43:04Z: validated CodeRabbit thread `PRRT_kwDORgvdZ8517C9c`; the review comment was correct because readiness was using only `listCandidateIssues()` for blocker/predecessor checks.
- 2026-03-21T22:43:04Z: fixed `buildReadinessSummary()` to iterate candidate issues but evaluate blockers and readiness reasons against `listAllIssues()`, and added regressions for both the summary builder and `Supervisor.statusReport()`.
- 2026-03-21T22:43:04Z: focused verification passed with `npx tsx --test src/supervisor/supervisor-selection-readiness-summary.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts src/backend/supervisor-http-server.test.ts src/backend/webui-dashboard.test.ts` and `npm run build`.
