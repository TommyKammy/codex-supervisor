# Issue #803: WebUI maintainability: split dashboard internals after the typed operator contract stabilizes

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/803
- Branch: codex/issue-803
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 74632060cb7eeb0f234527f75863249df36de5b0
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-22T00:17:40.578Z

## Latest Codex Summary
- Reproduced the maintainability gap with a focused browser-logic unit test, split the dashboard into page/script/browser-logic modules, and kept the inline WebUI contract stable with focused verification green.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: issue #803 is a maintainability-only refactor, so the safest proof is an extracted browser-logic unit seam that preserves the existing inline dashboard behavior while shrinking the monolithic module.
- What changed: split `src/backend/webui-dashboard.ts` into a small entry wrapper plus dedicated page, browser-script, and browser-logic modules; added a focused `webui-dashboard-browser-logic.test.ts` unit test for typed status-line assembly, typed issue shortcut collection, and selected-issue parsing.
- Current blocker: none
- Next exact step: commit the refactor checkpoint on `codex/issue-803`, then decide whether to open a draft PR immediately or continue with a local review pass over the split browser modules.
- Verification gap: none locally after `npm ci`; focused tests and `npm run build` passed.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/backend/webui-dashboard.ts`, `src/backend/webui-dashboard-page.ts`, `src/backend/webui-dashboard-browser-script.ts`, `src/backend/webui-dashboard-browser-logic.ts`, `src/backend/webui-dashboard-browser-logic.test.ts`
- Rollback concern: the inline browser script now injects stringified helper functions, so keep the sanitization step for compiler-added helper annotations or the VM harness will stop rendering selected-issue and shortcut state.
- Last focused command: `npm run build`
- Last focused failure: `webui-dashboard-browser-logic-missing-module`; the new focused test failed until the typed status/shortcut logic was extracted into a dedicated browser helper module.
- Last focused commands:
```bash
npx tsx --test src/backend/webui-dashboard-browser-logic.test.ts
npx tsx --test src/backend/webui-dashboard-browser-logic.test.ts src/backend/webui-dashboard.test.ts
npm ci
npm run build
```
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
- Local dirt besides this work remains the pre-existing untracked `.codex-supervisor/replay/` directory.
- 2026-03-22T00:24:19Z: reproduced the maintainability seam with a new `webui-dashboard-browser-logic.test.ts`; initial focused run failed with `MODULE_NOT_FOUND` for `./webui-dashboard-browser-logic`.
- 2026-03-22T00:24:19Z: split the dashboard into entry/page/browser-script/browser-logic modules and added helper injection for the inline script so the backend contract stayed unchanged.
- 2026-03-22T00:24:19Z: caught an injected-runtime regression where compiler-added `__name(...)` annotations leaked into the stringified helper source and prevented selected-issue/shortcut rendering in the VM harness; sanitized helper source before embedding and reran focused tests.
- 2026-03-22T00:24:19Z: restored local dependencies with `npm ci`; focused verification passed with `npx tsx --test src/backend/webui-dashboard-browser-logic.test.ts src/backend/webui-dashboard.test.ts` and `npm run build`.
- 2026-03-21T23:56:04Z: validated CodeRabbit thread `PRRT_kwDORgvdZ8517YKs`; the review comment was correct because the requeue click handler still called `rejectCommand()` without the explicit status argument.
- 2026-03-21T23:56:04Z: fixed the requeue no-loaded-issue rejection path to emit `requeue cancelled` and added a focused dashboard harness regression asserting the concise status plus zero POST attempts.
- 2026-03-21T23:56:04Z: focused verification passed with `npx tsx --test src/backend/webui-dashboard.test.ts src/backend/supervisor-http-server.test.ts` and `npm run build`.
- 2026-03-22T00:00:00Z: reproduced stale post-command refresh handling with a new dashboard harness case where bootstrap loaded issue #42, `run-once` refreshed status to selected issue #77, and the UI incorrectly kept `#42` selected until state was split into supervisor-selected vs loaded issue numbers.
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
