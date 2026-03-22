# Issue #813: WebUI operator timeline: correlate safe-command results with live supervisor events

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/813
- Branch: codex/issue-813
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: draft_pr
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 96f3858651e8bd127992c3f57e2e1acc2980abac
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-22T03:29:25Z

## Latest Codex Summary
- Reproduced the missing operator timeline with a focused dashboard harness regression, then added a browser-only combined timeline that records command results, command-triggered refresh deltas, and correlated SSE events in one feed.
- Focused verification passed with `npx tsx --test src/backend/webui-dashboard-browser-logic.test.ts src/backend/webui-dashboard.test.ts src/backend/supervisor-http-server.test.ts` and `npm run build` after restoring local dependencies with `npm ci`; the implementation is committed as `96f3858` (`Add dashboard operator timeline`) and draft PR #819 is open.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the missing operator narrative was entirely a dashboard/browser gap; the existing safe-command DTOs plus SSE event stream were already sufficient if the client rendered a bounded combined timeline and a concise post-command refresh delta.
- What changed: added focused browser-logic coverage for selection-change and event summaries; added a focused dashboard regression that proves a `run-once` result and the following `supervisor.active_issue.changed` event appear in one operator timeline; extended the browser script with a bounded `operator-timeline` feed that records commands, refresh deltas, and correlated events; added the new panel to the dashboard shell and asserted it in the HTTP server page test.
- Current blocker: none
- Next exact step: monitor draft PR #819 (`https://github.com/TommyKammy/codex-supervisor/pull/819`) and address any CI or review feedback; GitHub currently reports merge state `UNSTABLE` while checks have not settled.
- Verification gap: none locally; broader CI is still pending on the draft PR.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/backend/supervisor-http-server.test.ts`, `src/backend/webui-dashboard-browser-logic.test.ts`, `src/backend/webui-dashboard-browser-logic.ts`, `src/backend/webui-dashboard-browser-script.ts`, `src/backend/webui-dashboard-page.ts`, `src/backend/webui-dashboard.test.ts`
- Rollback concern: keep the correlation logic thin and browser-only; do not turn the timeline into a backend persistence feature or widen the safe-command surface.
- Last focused command: `gh pr view 819 --json number,state,isDraft,url,mergeStateStatus,reviewDecision,headRefName,baseRefName`
- Last focused failure: none
- Last focused commands:
```bash
npx tsx --test src/backend/webui-dashboard-browser-logic.test.ts
npx tsx --test src/backend/webui-dashboard.test.ts
npx tsx --test src/backend/webui-dashboard-browser-logic.test.ts src/backend/webui-dashboard.test.ts src/backend/supervisor-http-server.test.ts
npm ci
npm run build
gh pr view --json number,state,isDraft,url,mergeStateStatus,reviewDecision,headRefName,baseRefName
git push -u origin codex/issue-813
gh pr create --draft --base main --head codex/issue-813 --title "Add WebUI operator timeline" --body ...
gh pr view 819 --json number,state,isDraft,url,mergeStateStatus,reviewDecision,headRefName,baseRefName
```
### Scratchpad
- 2026-03-22T03:29:25Z: committed `96f3858` (`Add dashboard operator timeline`), pushed `codex/issue-813`, opened draft PR #819 (`https://github.com/TommyKammy/codex-supervisor/pull/819`), and confirmed GitHub currently reports merge state `UNSTABLE`.
- 2026-03-22T03:28:21Z: reproduced #813 with a new dashboard harness test that expected a single `operator-timeline` feed to show `run-once`, the resulting selected-issue delta, and a subsequent `supervisor.active_issue.changed` SSE event in order.
- 2026-03-22T03:28:21Z: implemented a browser-only operator timeline with concise event/selection summary helpers; the first pass exposed a browser injection bug because the new helpers referenced a non-injected formatter, and exporting/injecting `formatIssueRef()` fixed the broken refresh chain.
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
