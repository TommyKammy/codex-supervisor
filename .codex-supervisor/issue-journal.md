# Issue #823: WebUI tracked history: move tracked issues into a dedicated panel with non-done default

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/823
- Branch: codex/issue-823
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: draft_pr
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 6528d38c56b1d48818fc2adf65eb71e1db7ca7e8
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-22T07:14:24Z

## Latest Codex Summary
- Reproduced the missing tracked-history surface with focused browser-logic and dashboard tests, then added a dedicated WebUI tracked-history panel that defaults to non-`done` issues and exposes a toggle to reveal completed history without polluting the main Summary panel. Focused WebUI verification and `npm run build` passed locally after restoring dependencies with `npm ci`, the branch was committed as `6528d38`, pushed to `origin/codex/issue-823`, and draft PR #830 was opened.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the remaining #823 gap was entirely in the browser projection layer, because typed `trackedIssues` already existed but the dashboard still lacked a dedicated history panel and a default non-`done` filter.
- What changed: added focused failing assertions for tracked-history filtering and rendering, introduced tracked-history formatting helpers with a non-`done` default, added a dedicated `Tracked history` panel plus toggle in the dashboard page/script, and kept the main Summary panel count-only.
- Current blocker: none
- Next exact step: monitor draft PR #830 for CI and review feedback, and repair only if new failures or comments appear.
- Verification gap: none for the scoped tracked-history behavior; focused dashboard/browser-logic tests and `npm run build` passed locally after `npm ci`.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/backend/webui-dashboard-browser-logic.test.ts`, `src/backend/webui-dashboard-browser-logic.ts`, `src/backend/webui-dashboard-browser-script.ts`, `src/backend/webui-dashboard-page.ts`, `src/backend/webui-dashboard.test.ts`
- Rollback concern: keep the Summary panel count-only and the tracked-history toggle browser-side; avoid moving `done` filtering into the backend so operators can still reveal full tracked history on demand.
- Last focused command: `npm run build`
- Last focused failure: `tracked-history-panel-missing`
- Last focused commands:
```bash
npx tsx --test src/backend/webui-dashboard-browser-logic.test.ts
npx tsx --test src/backend/webui-dashboard.test.ts
npx tsx --test src/backend/webui-dashboard.test.ts src/backend/webui-dashboard-browser-logic.test.ts
npm run build
npm ci
npx tsx --test src/backend/webui-dashboard.test.ts src/backend/webui-dashboard-browser-logic.test.ts
npm run build
git commit -m "Add dedicated tracked history panel"
git push -u origin codex/issue-823
gh pr create --draft --base main --head codex/issue-823 --title "WebUI tracked history: move tracked issues into dedicated panel" --body-file /tmp/issue-823-pr-body.md
```
### Scratchpad
- 2026-03-22T07:14:24Z: reproduced #823 with focused failures in `formatTrackedIssues()` and the dashboard harness because `done` tracked issues were still shown by default and there was no dedicated tracked-history panel.
- 2026-03-22T07:14:24Z: implemented a dedicated `Tracked history` panel with a browser-side `Show done issues` toggle, kept the Summary panel count-only, and added focused regressions for the non-`done` default plus reveal path.
- 2026-03-22T07:14:24Z: focused verification passed with `npx tsx --test src/backend/webui-dashboard.test.ts src/backend/webui-dashboard-browser-logic.test.ts`; `npm run build` initially failed because `tsc` was missing, `npm ci` restored dependencies, and `npm run build` then passed.
- 2026-03-22T07:14:24Z: committed `6528d38` (`Add dedicated tracked history panel`), pushed `codex/issue-823`, and opened draft PR #830 (`https://github.com/TommyKammy/codex-supervisor/pull/830`).
- 2026-03-22T06:48:38+00:00: implemented `formatTrackedIssueSummary()` and switched `buildStatusLines()` to use it, preserving `trackedIssues` for typed issue shortcuts while removing tracked-history rows from the main Summary panel.
- 2026-03-22T06:48:38+00:00: focused verification passed with `npx tsx --test src/backend/webui-dashboard.test.ts src/backend/webui-dashboard-browser-logic.test.ts`.
- 2026-03-22T06:48:38+00:00: initial `npm run build` failed because `tsc` was missing in this worktree; restored dependencies with `npm ci`, reran the focused tests, and `npm run build` then passed.
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
