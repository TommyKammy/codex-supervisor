# Issue #828: Setup readiness DTO: add a typed backend first-run config and host-readiness summary

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/828
- Branch: codex/issue-828
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: d1444cb4c19ac8c1808cb2e5cd80f3b96e49a903
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-22T09:34:36.168Z

## Latest Codex Summary
- Added a real typed `SetupReadinessReport` backend query separate from `doctor`, wired it through `Supervisor` and `SupervisorService`, and verified the focused setup-readiness test suite plus `npm run build` after restoring local dependencies with `npm ci`.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the real gap was runtime, not docs: the repo had `doctor` and bootstrap helpers but no dedicated typed backend query for first-run setup readiness.
- What changed: added `src/setup-readiness.ts` with a typed `SetupReadinessReport`, derived typed setup fields/blockers plus host/provider/trust posture, and wired `Supervisor.setupReadinessReport()` through `SupervisorService.querySetupReadiness()`.
- Current blocker: none
- Next exact step: review the diff for any scope tightening, then commit the typed setup-readiness checkpoint on `codex/issue-828`.
- Verification gap: none in the requested focused scope; `src/doctor.test.ts`, `src/config.test.ts`, `src/supervisor/supervisor-service.test.ts`, and `npm run build` passed locally.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/doctor.test.ts`, `src/setup-readiness.ts`, `src/supervisor/supervisor-service.test.ts`, `src/supervisor/supervisor-service.ts`, `src/supervisor/supervisor.ts`
- Rollback concern: keep setup-readiness limited to first-run config/posture summary and avoid letting repair-oriented `doctor` findings become setup blockers except for hard host failures.
- Last focused command: `npx tsx --test src/doctor.test.ts src/config.test.ts src/supervisor/supervisor-service.test.ts`
- Last focused failure: `missing-setup-readiness-query`
- Last focused commands:
```bash
npx tsx --test src/doctor.test.ts src/supervisor/supervisor-service.test.ts
npx tsx --test src/doctor.test.ts src/config.test.ts src/supervisor/supervisor-service.test.ts
npm ci
npm run build
```
### Scratchpad
- 2026-03-22T18:44:30+09:00: reproduced the runtime gap with focused tests that required a dedicated `setup-readiness` module and `SupervisorService.querySetupReadiness()`; the first failing signature was missing module/query support rather than a docs mismatch.
- 2026-03-22T18:44:30+09:00: implemented `src/setup-readiness.ts` to report typed setup fields, typed blockers, host-readiness checks, provider posture, and trust posture without changing `doctor`.
- 2026-03-22T18:44:30+09:00: initial `npm run build` failed because `tsc` was missing in this worktree; restored dependencies with `npm ci`, fixed one TypeScript inference error in `src/supervisor/supervisor-service.test.ts`, and reran the build successfully.
- 2026-03-22T18:12:25+09:00: reproduced the issue with a new docs assertion that required a setup/readiness contract distinct from `doctor`; `npx tsx --test src/getting-started-docs.test.ts` initially failed on missing contract text.
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
