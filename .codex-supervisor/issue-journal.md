# Issue #802: WebUI operator UX: improve safe-command feedback and refresh behavior

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/802
- Branch: codex/issue-802
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 944c6857a5b16c2430b49de9d08a6b3db50d5b0e
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-21T23:28:54.553Z

## Latest Codex Summary
- Reproduced two operator-UX gaps with focused dashboard regressions: declined confirm-only safe commands produced no visible rejection feedback, and command-triggered refreshes kept reloading a stale previously selected issue instead of adopting the refreshed supervisor selection.
- Split dashboard state between the supervisor-selected issue badge and the currently loaded issue details, then routed command/event refreshes through the refreshed selection to avoid stale detail reloads.
- Added explicit rejected-command feedback for browser-side rejections so declined confirmations persist a visible cancelled result without posting to the backend.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the WebUI command surface still had two operator-UX gaps: browser-side command rejections were silent, and post-command refreshes could preserve stale issue detail state even after supervisor selection changed.
- What changed: added focused dashboard regressions for declined confirmation feedback and post-command selection refresh, split selected-vs-loaded issue state in the dashboard, and surfaced cancelled command results for confirm-only safe commands.
- Current blocker: none
- Next exact step: commit this checkpoint on `codex/issue-802`, then open or update the draft PR with the focused command-feedback and refresh-behavior fix.
- Verification gap: none locally after restoring dependencies with `npm ci`; remote CI has not run on this checkpoint yet.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/backend/webui-dashboard.test.ts`, `src/backend/webui-dashboard.ts`
- Rollback concern: keep supervisor-selected issue state separate from manually loaded issue details so refreshes follow backend selection without breaking explicit issue inspection or widening the command surface.
- Last focused command: `npm run build`
- Last focused failure: `dashboard_stale_selection_after_command_refresh`; command-triggered refreshes held onto stale issue detail state and declined confirm-only commands produced no visible rejection feedback.
- Last focused commands:
```bash
npx tsx --test src/backend/webui-dashboard.test.ts src/backend/supervisor-http-server.test.ts
npm ci
npm run build
```
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
- Local dirt besides this work remains the pre-existing untracked `.codex-supervisor/replay/` directory.
- 2026-03-22T00:00:00Z: reproduced stale post-command refresh handling with a new dashboard harness case where bootstrap loaded issue #42, `run-once` refreshed status to selected issue #77, and the UI incorrectly kept `#42` selected until state was split into supervisor-selected vs loaded issue numbers.
- 2026-03-22T00:00:00Z: reproduced missing rejection feedback with a confirm-decline dashboard case for prune workspaces; the browser returned early without a visible command result until declined confirmations were routed through a rejected-command renderer.
- 2026-03-22T00:00:00Z: focused verification passed with `npx tsx --test src/backend/webui-dashboard.test.ts`, `npx tsx --test src/backend/webui-dashboard.test.ts src/backend/supervisor-http-server.test.ts`, `npm ci`, and `npm run build`.
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
