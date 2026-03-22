# Issue #810: WebUI contract follow-up: expose typed operator activity context for richer issue detail views

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/810
- Branch: codex/issue-810
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: deaa3fa8a89a93f2721b6e339635510bbfa35a32
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-22T01:09:36.776Z

## Latest Codex Summary
- None yet.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the WebUI gap is a missing typed `activityContext` contract on status/explain DTOs, so the safest fix is a shared operator-context helper that reuses existing handoff, recovery, summary, and review-wait sources without changing CLI rendering.
- What changed: added `src/supervisor/supervisor-operator-activity-context.ts`; threaded nullable `activityContext` through `SupervisorActiveIssueDto`, `ActiveIssueStatusSnapshot`, and `SupervisorExplainDto`; populated it from existing status/explain summaries and structured review-wait/latest-recovery data; added focused contract coverage in `supervisor-diagnostics-status-selection.test.ts`, `supervisor-selection-issue-explain.test.ts`, `supervisor-http-server.test.ts`, and updated `supervisor-runtime.test.ts` for the new typed field.
- Current blocker: none
- Next exact step: review the DTO shape against the dashboard consumer and open/update the draft PR once the contract looks coherent.
- Verification gap: none locally after `npm ci`; the focused issue verification and `npm run build` passed.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/backend/supervisor-http-server.test.ts`, `src/cli/supervisor-runtime.test.ts`, `src/supervisor/supervisor-diagnostics-status-selection.test.ts`, `src/supervisor/supervisor-operator-activity-context.ts`, `src/supervisor/supervisor-selection-active-status.ts`, `src/supervisor/supervisor-selection-issue-explain.test.ts`, `src/supervisor/supervisor-selection-issue-explain.ts`, `src/supervisor/supervisor-status-report.ts`, `src/supervisor/supervisor.ts`
- Rollback concern: `activityContext` is intentionally nullable for empty cases so older tests and consumers do not have to special-case empty objects; keep that behavior if the contract is reshaped.
- Last focused command: `npm run build`
- Last focused failure: `typed-operator-activity-context-missing`; the new focused tests failed until status/explain started returning shared typed operator activity context.
- Last focused commands:
```bash
npx tsx --test src/supervisor/supervisor-diagnostics-status-selection.test.ts src/supervisor/supervisor-selection-issue-explain.test.ts src/backend/supervisor-http-server.test.ts
npm ci
npm run build
```
### Scratchpad
- 2026-03-22T01:16:24Z: reproduced the contract gap with focused status/explain tests expecting a typed nullable `activityContext` surface for handoff summaries, latest recovery, and active configured-bot wait windows.
- 2026-03-22T01:16:24Z: added shared operator activity DTO helpers and threaded them through active status plus explain without changing CLI string rendering; HTTP and runtime tests were updated for the new typed field.
- 2026-03-22T01:16:24Z: focused verification passed with `npx tsx --test src/supervisor/supervisor-diagnostics-status-selection.test.ts src/supervisor/supervisor-selection-issue-explain.test.ts src/backend/supervisor-http-server.test.ts`; `npm run build` initially failed because `tsc` was missing, then passed after `npm ci`.
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
