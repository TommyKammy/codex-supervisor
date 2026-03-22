# Issue #811: WebUI issue detail UX: render richer operator-facing issue context from typed backend models

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/811
- Branch: codex/issue-811
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: draft_pr
- Attempt count: 2 (implementation=2, repair=0)
- Last head SHA: 95e1fc4cf16611f1e9511d0422719141e1a1b7d6
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-22T02:21:55Z

## Latest Codex Summary
Added a narrow dashboard reproducer that proved the issue detail view still rendered typed explain data as a flat text block. Reworked the browser-only issue detail renderer to build typed operator-facing sections for selection context, operator activity, review waits, latest recovery, and recent failure, and swapped the issue detail container from a `<pre>` to a structured card grid. Committed the checkpoint as `95e1fc4` (`Render typed issue detail cards in WebUI`), pushed `codex/issue-811`, and opened draft PR #817 (`https://github.com/TommyKammy/codex-supervisor/pull/817`).

Focused verification passed with `npx tsx --test src/backend/webui-dashboard-browser-logic.test.ts src/backend/webui-dashboard.test.ts src/backend/supervisor-http-server.test.ts` and `npm run build` after restoring local dependencies with `npm ci`.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the remaining UX gap for #811 was entirely in the browser renderer; the typed backend explain DTO already carried enough operator context, but the dashboard was still collapsing it into a flat key-value dump.
- What changed: added a focused failing dashboard test for structured issue-detail sections; replaced the issue-detail `<pre>` with a card-grid container in `src/backend/webui-dashboard-page.ts`; updated `src/backend/webui-dashboard-browser-script.ts` to render typed sections for selection context, operator activity, review waits, latest recovery, and recent failure; updated the dashboard test harness fake DOM so parent `textContent` reflects rendered children.
- Current blocker: none
- Next exact step: monitor draft PR #817 for CI and review feedback, then address any follow-up issues.
- Verification gap: none beyond broader CI.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/backend/webui-dashboard-browser-script.ts`, `src/backend/webui-dashboard-page.ts`, `src/backend/webui-dashboard.test.ts`
- Rollback concern: keep `latestRecoverySummary` as a fallback-only source; the richer UI should continue preferring typed `activityContext` when it is present rather than reintroducing summary scraping.
- Last focused command: `npm run build`
- Last focused failure: `flat_issue_detail_dump`; the issue detail panel rendered typed operator context as a flat text block instead of structured sections.
- Last focused commands:
```bash
npx tsx --test src/backend/webui-dashboard.test.ts
npx tsx --test src/backend/webui-dashboard-browser-logic.test.ts src/backend/webui-dashboard.test.ts src/backend/supervisor-http-server.test.ts
npm ci
npm run build
```
### Scratchpad
- 2026-03-22T02:21:55Z: reproduced #811 with a new dashboard harness case that expected typed explain data to render as structured issue-detail sections instead of a flat text block; the initial failure was `issueExplain.children.length >= 4` because the dashboard still wrote a monolithic string into the issue detail container.
- 2026-03-22T02:21:55Z: implemented the browser-only issue detail card grid using typed explain DTO fields, preserving legacy `latestRecoverySummary` as a fallback-only source and keeping all selection/blocking logic server-driven.
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
