# Issue #812: WebUI live-state UX: make connection health, staleness, and refresh state explicit

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/812
- Branch: codex/issue-812
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: stabilizing
- Attempt count: 2 (implementation=2, repair=0)
- Last head SHA: 78862c79ca57ef6387a384956901a00361d8dd79
- Blocked reason: none
- Last failure signature: stale-stabilizing-no-pr-recovery-loop
- Repeated failure signature count: 1
- Updated at: 2026-03-22T02:58:35.160Z

## Latest Codex Summary
Implemented and pushed `78862c7` (`Make dashboard live state explicit`), then opened draft PR #818 (`https://github.com/TommyKammy/codex-supervisor/pull/818`).

The dashboard hero now exposes separate live-state badges for connection, freshness, refresh phase, and last refresh time in [src/backend/webui-dashboard-page.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-812/src/backend/webui-dashboard-page.ts#L382). The browser script tracks those states explicitly and marks the UI stale on SSE reconnects or failed refreshes without changing backend transport semantics in [src/backend/webui-dashboard-browser-script.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-812/src/backend/webui-dashboard-browser-script.ts#L31) and [src/backend/webui-dashboard-browser-script.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-812/src/backend/webui-dashboard-browser-script.ts#L128). Focused browser/state helpers and regressions cover the live-state model in [src/backend/webui-dashboard-browser-logic.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-812/src/backend/webui-dashboard-browser-logic.ts#L185), [src/backend/webui-dashboard-browser-logic.test.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-812/src/backend/webui-dashboard-browser-logic.test.ts), and [src/backend/webui-dashboard.test.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-812/src/backend/webui-dashboard.test.ts#L706).

This turn reran the focused verification set and `npm run build`; both passed again before the branch was pushed. Draft PR #818 is open against `main` with merge state `CLEAN`.

Summary: Pushed the live-state UX implementation, reran focused verification, and opened draft PR #818
State hint: draft_pr
Blocked reason: none
Tests: `npx tsx --test src/backend/webui-dashboard.test.ts src/backend/webui-dashboard-browser-logic.test.ts src/backend/supervisor-http-server.test.ts`; `npm run build`
Failure signature: none
Next action: monitor PR #818 checks and address any review or CI feedback

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: #812 is purely a WebUI/browser-state gap; operators already have the raw HTTP+SSE transport, but the dashboard needs first-class browser-rendered live-state badges to distinguish connected, refreshing, stale, and failed-refresh states.
- What changed: added focused live-state regressions in `src/backend/webui-dashboard.test.ts` plus pure helper coverage in `src/backend/webui-dashboard-browser-logic.test.ts`; extended the hero badge row in `src/backend/webui-dashboard-page.ts` with freshness and refresh badges; added a small live-state model and render path in `src/backend/webui-dashboard-browser-script.ts`; added browser-logic helpers for normalized connection/freshness labels in `src/backend/webui-dashboard-browser-logic.ts`; extended the dashboard harness `MockEventSource` to drive SSE open/error transitions; pushed `codex/issue-812` and opened draft PR #818.
- Current blocker: none
- Next exact step: monitor draft PR #818 and address any CI or review feedback that appears.
- Verification gap: none beyond broader CI.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/backend/webui-dashboard-browser-logic.test.ts`, `src/backend/webui-dashboard-browser-logic.ts`, `src/backend/webui-dashboard-browser-script.ts`, `src/backend/webui-dashboard-page.ts`, `src/backend/webui-dashboard.test.ts`
- Rollback concern: keep the live-state model browser-only and derived from existing HTTP/SSE behavior; do not introduce backend transport semantics changes just to drive the badges.
- Last focused command: `gh pr view 818 --json number,state,isDraft,url,mergeStateStatus,reviewDecision,headRefName,baseRefName`
- Last focused failure: none
- Last focused commands:
```bash
npx tsx --test src/backend/webui-dashboard-browser-logic.test.ts src/backend/webui-dashboard.test.ts src/backend/supervisor-http-server.test.ts
npm run build
git push -u origin codex/issue-812
gh pr create --draft --base main --head codex/issue-812 --title "Make dashboard live state explicit" --body ...
gh pr view 818 --json number,state,isDraft,url,mergeStateStatus,reviewDecision,headRefName,baseRefName
```
### Scratchpad
- 2026-03-22T12:00:23+09:00: reran focused verification with `npx tsx --test src/backend/webui-dashboard.test.ts src/backend/webui-dashboard-browser-logic.test.ts src/backend/supervisor-http-server.test.ts` and `npm run build`; both passed before the PR push.
- 2026-03-22T12:00:23+09:00: pushed `codex/issue-812` to origin and opened draft PR #818 (`https://github.com/TommyKammy/codex-supervisor/pull/818`); GitHub reports merge state `CLEAN`.
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
