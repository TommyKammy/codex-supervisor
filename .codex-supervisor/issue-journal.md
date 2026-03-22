# Issue #827: Setup readiness contract: define the typed first-run backend model separately from doctor

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/827
- Branch: codex/issue-827
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 580d6b37dfe8b10c4f349d7a99ea864e389c2ea4
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-22T09:10:29.500Z

## Latest Codex Summary
- Added a focused docs assertion for the missing first-run setup/readiness contract, documented the typed contract in `docs/getting-started.md`, and verified the scoped docs suite plus `npm run build` after restoring local dependencies with `npm ci`.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the issue was a docs-contract gap rather than a runtime bug, because the repo already exposed `doctor` and bootstrap helpers but did not document a separate typed first-run setup/readiness surface.
- What changed: added a focused failing assertion in `src/getting-started-docs.test.ts`, documented a dedicated `SetupReadinessReport` contract in `docs/getting-started.md`, and explicitly separated first-run setup/readiness from `doctor`.
- Current blocker: none
- Next exact step: commit the docs/test checkpoint on `codex/issue-827`, then open or update the draft PR for review.
- Verification gap: none for the scoped docs contract; the targeted docs tests and `npm run build` passed locally after `npm ci`.
- Files touched: `.codex-supervisor/issue-journal.md`, `docs/getting-started.md`, `src/getting-started-docs.test.ts`
- Rollback concern: keep the setup/readiness contract limited to first-run guidance and do not collapse repair-oriented `doctor` diagnostics back into that typed surface.
- Last focused command: `npm run build`
- Last focused failure: `setup-readiness-contract-missing`
- Last focused commands:
```bash
npx tsx --test src/getting-started-docs.test.ts
npx tsx --test src/readme-docs.test.ts src/getting-started-docs.test.ts src/agent-instructions-docs.test.ts
npm run build
npm ci
npm run build
```
### Scratchpad
- 2026-03-22T18:12:25+09:00: reproduced the issue with a new docs assertion that required a setup/readiness contract distinct from `doctor`; `npx tsx --test src/getting-started-docs.test.ts` initially failed on missing contract text.
- 2026-03-22T18:12:25+09:00: documented a typed `SetupReadinessReport` shape and first-run-only rules in `docs/getting-started.md`, then verified with `npx tsx --test src/readme-docs.test.ts src/getting-started-docs.test.ts src/agent-instructions-docs.test.ts`.
- 2026-03-22T18:12:25+09:00: initial `npm run build` failed because `tsc` was missing in this worktree; restored dependencies with `npm ci`, then reran `npm run build` successfully.
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
