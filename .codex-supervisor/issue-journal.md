# Issue #829: Setup readiness API: expose the typed first-run backend model over HTTP

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/829
- Branch: codex/issue-829
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: cc67c542b99a60e072c5a3c44dfdd789130beb7d
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-22T10:06:52.527Z

## Latest Codex Summary
- Reproduced the missing setup-readiness transport with a focused HTTP server regression, then exposed the typed `SetupReadinessReport` over `GET /api/setup-readiness` using the existing JSON backend style.
- Focused verification passed with `npx tsx --test src/backend/supervisor-http-server.test.ts src/supervisor/supervisor-service.test.ts` and `npm run build` after restoring local dependencies with `npm ci`.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the remaining gap for #829 was only backend transport; the typed setup-readiness model already existed behind `SupervisorService.querySetupReadiness()` but the HTTP server did not expose it.
- What changed: added a focused regression in `src/backend/supervisor-http-server.test.ts` for `GET /api/setup-readiness`, then wired that route in `src/backend/supervisor-http-server.ts` as a read-only JSON endpoint that returns the existing typed `SetupReadinessReport`.
- Current blocker: none
- Next exact step: commit the HTTP transport checkpoint on `codex/issue-829`, push the branch, and open a draft PR if one does not already exist.
- Verification gap: none in the requested focused scope; `src/backend/supervisor-http-server.test.ts`, `src/supervisor/supervisor-service.test.ts`, and `npm run build` passed locally after `npm ci`.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/backend/supervisor-http-server.test.ts`, `src/backend/supervisor-http-server.ts`
- Rollback concern: keep the setup-readiness route read-only and continue serving the existing typed model directly instead of introducing a second transport-specific contract.
- Last focused command: `npx tsx --test src/backend/supervisor-http-server.test.ts src/supervisor/supervisor-service.test.ts`
- Last focused failure: `missing-setup-readiness-http-endpoint`
- Last focused commands:
```bash
npx tsx --test src/backend/supervisor-http-server.test.ts
npx tsx --test src/backend/supervisor-http-server.test.ts src/supervisor/supervisor-service.test.ts
npm ci
npm run build
```
### Scratchpad
- 2026-03-22T19:09:05+09:00: reproduced the transport gap with a focused `GET /api/setup-readiness` assertion in `src/backend/supervisor-http-server.test.ts`; the server returned 404 before implementation.
- 2026-03-22T19:09:05+09:00: added a read-only `/api/setup-readiness` route in `src/backend/supervisor-http-server.ts` that returns `service.querySetupReadiness()` when available and otherwise preserves the existing `Not found.` behavior.
- 2026-03-22T19:09:05+09:00: focused verification passed with `npx tsx --test src/backend/supervisor-http-server.test.ts src/supervisor/supervisor-service.test.ts`; `npm run build` initially failed because `tsc` was missing in this worktree, so `npm ci` was run and `npm run build` then passed.
- 2026-03-22T18:12:25+09:00: documented a typed `SetupReadinessReport` shape and first-run-only rules in `docs/getting-started.md`, then verified with `npx tsx --test src/readme-docs.test.ts src/getting-started-docs.test.ts src/agent-instructions-docs.test.ts`.
- 2026-03-22T18:12:25+09:00: initial `npm run build` failed because `tsc` was missing in this worktree; restored dependencies with `npm ci`, then reran `npm run build` successfully.
- 2026-03-22T18:12:25+09:00: committed `53342c7` (`Document setup readiness contract`), pushed `codex/issue-827`, and opened draft PR #832 (`https://github.com/TommyKammy/codex-supervisor/pull/832`).
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
