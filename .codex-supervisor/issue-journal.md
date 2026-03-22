# Issue #812: WebUI live-state UX: make connection health, staleness, and refresh state explicit

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/812
- Branch: codex/issue-812
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: f25994a773bace8ac7b6f5dbc77318f10f2b3546
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-22T02:47:42Z

## Latest Codex Summary
- Reproduced the live-state UX gap with focused dashboard tests that expected explicit refresh and freshness badges plus explicit stale state during SSE reconnects.
- Added a small browser-side live-state model for connection health, refresh phase, freshness, and last-refresh time; the dashboard now renders those states explicitly without changing backend transport semantics.
- Focused verification passed with `npx tsx --test src/backend/webui-dashboard-browser-logic.test.ts src/backend/webui-dashboard.test.ts src/backend/supervisor-http-server.test.ts` and `npm run build` after restoring local dependencies with `npm ci`.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: #812 is purely a WebUI/browser-state gap; operators already have the raw HTTP+SSE transport, but the dashboard needs first-class browser-rendered live-state badges to distinguish connected, refreshing, stale, and failed-refresh states.
- What changed: added focused live-state regressions in `src/backend/webui-dashboard.test.ts` plus pure helper coverage in `src/backend/webui-dashboard-browser-logic.test.ts`; extended the hero badge row in `src/backend/webui-dashboard-page.ts` with freshness and refresh badges; added a small live-state model and render path in `src/backend/webui-dashboard-browser-script.ts`; added browser-logic helpers for normalized connection/freshness labels in `src/backend/webui-dashboard-browser-logic.ts`; extended the dashboard harness `MockEventSource` to drive SSE open/error transitions.
- Current blocker: none
- Next exact step: commit the live-state UX changes on `codex/issue-812`, then open or update the draft PR for #812 if one is not already present.
- Verification gap: none beyond broader CI.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/backend/webui-dashboard-browser-logic.test.ts`, `src/backend/webui-dashboard-browser-logic.ts`, `src/backend/webui-dashboard-browser-script.ts`, `src/backend/webui-dashboard-page.ts`, `src/backend/webui-dashboard.test.ts`
- Rollback concern: keep the live-state model browser-only and derived from existing HTTP/SSE behavior; do not introduce backend transport semantics changes just to drive the badges.
- Last focused command: `npm run build`
- Last focused failure: `live_state_not_explicit`; the dashboard lacked explicit refresh/freshness badges and did not surface stale state during SSE reconnects or refresh failures.
- Last focused commands:
```bash
npx tsx --test src/backend/webui-dashboard-browser-logic.test.ts src/backend/webui-dashboard.test.ts src/backend/supervisor-http-server.test.ts
npm ci
npm run build
```
### Scratchpad
- 2026-03-22T02:47:42Z: reproduced the #812 gap with focused dashboard tests that expected explicit `refresh-state` and `freshness-state` badges plus stale state during SSE reconnects; initial run failed because those badges did not exist.
- 2026-03-22T02:47:42Z: added browser-only live-state helpers and badge rendering for connection health, refresh phase, freshness, and last refresh time without changing backend transport semantics.
- 2026-03-22T02:47:42Z: focused verification passed with `npx tsx --test src/backend/webui-dashboard-browser-logic.test.ts src/backend/webui-dashboard.test.ts src/backend/supervisor-http-server.test.ts`; `npm run build` initially failed because `tsc` was missing in the worktree, then passed after `npm ci`.
- 2026-03-22T02:21:55Z: focused verification passed with `npx tsx --test src/backend/webui-dashboard-browser-logic.test.ts src/backend/webui-dashboard.test.ts src/backend/supervisor-http-server.test.ts` and `npm run build` after restoring local dependencies with `npm ci`.
- 2026-03-22T02:21:55Z: committed `95e1fc4` (`Render typed issue detail cards in WebUI`), pushed `codex/issue-811`, and opened draft PR #817 (`https://github.com/TommyKammy/codex-supervisor/pull/817`).
- 2026-03-22T01:56:22Z: reduced the stored CodeRabbit failure excerpt in `.codex-supervisor/issue-journal.md` to a concise MD038 summary so the journal no longer preserves malformed inline code spans verbatim; the direct backtick-boundary scan is now clean, while full markdownlint still reports unrelated long-standing journal style violations.
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
