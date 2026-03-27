# Issue #1097: Add CI hardening for rate-limit status rendering and inventory cache edge cases

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1097
- Branch: codex/issue-1097
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: bf7d80e2ff84ca9015c7b76ea77693f4626e5f4d
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-27T03:46:14.711Z

## Latest Codex Summary
- Added focused regressions for DTO-driven `github_rate_limit` rendering and full-inventory cache timing/invalidation, then fixed the corresponding supervisor behavior and verified the requested test/build commands.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the status renderer should derive canonical `github_rate_limit` lines from structured DTO telemetry, and the loop inventory cache should only become fresh after a fetch actually completes.
- What changed: added a focused `renderSupervisorStatusDto(...)` regression that fails when `dto.githubRateLimit` is present but `detailedStatusLines` is empty, plus focused `listLoopIssueInventory()` regressions for post-await cache timestamping and cache clearing after a failed refresh past TTL expiry. Updated `renderSupervisorStatusDto(...)` to append canonical rate-limit lines from `dto.githubRateLimit` without duplicating pre-rendered lines, and changed `listLoopIssueInventory()` to stamp `fetchedAtMs` with `Date.now()` after `await this.github.listAllIssues()` succeeds while still clearing the cached full inventory on refresh failure.
- Current blocker: none locally.
- Next exact step: review the final diff, commit the focused `#1097` checkpoint on `codex/issue-1097`, and open a draft PR if one is still missing.
- Verification gap: I have not run the full repo test suite or an end-to-end supervisor loop; verification is limited to the issue-targeted status/inventory tests plus a clean TypeScript build after installing local dev dependencies with `npm ci`.
- Files touched: `src/supervisor/supervisor-status-report.ts`; `src/supervisor/supervisor.ts`; `src/supervisor/supervisor-diagnostics-status-selection.test.ts`; `src/supervisor/supervisor.test.ts`; `.codex-supervisor/issue-journal.md`.
- Rollback concern: low. The behavior change is limited to canonical rendering of already-typed rate-limit telemetry and to when the in-memory full-inventory cache becomes fresh.
- Last focused command: `npm run build`
- What changed this turn: reread the required memory files and issue journal, traced the status renderer and loop inventory cache paths, added focused reproducing tests, reproduced the DTO rendering failure and the stale pre-await inventory timestamp bug, patched both code paths, installed local dev dependencies with `npm ci`, reran the focused test files, and completed the requested build verification.
- Exact failure reproduced this turn: `renderSupervisorStatusDto(...)` omitted `github_rate_limit` lines when callers provided only `dto.githubRateLimit`, and `listLoopIssueInventory()` treated a long-running refresh as older than it really was because it stored `fetchedAtMs` from before `await this.github.listAllIssues()` completed.
- Commands run this turn: `sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self-clean/.local/memory/TommyKammy-codex-supervisor/issue-1097/AGENTS.generated.md`; `sed -n '1,260p' /home/tommy/Dev/codex-supervisor-self-clean/.local/memory/TommyKammy-codex-supervisor/issue-1097/context-index.md`; `sed -n '1,320p' .codex-supervisor/issue-journal.md`; `git branch --show-current`; `git status --short`; `rg -n "githubRateLimit|github_rate_limit|renderSupervisorStatusDto|listLoopIssueInventory|fetchedAtMs|inventory" src/supervisor src -g'*.ts'`; `rg --files src | rg 'supervisor.*(status|diagnostics)|supervisor\\.test|inventory|cache'`; `sed -n '1,260p' src/supervisor/supervisor-status-report.ts`; `sed -n '500,580p' src/supervisor/supervisor.ts`; `sed -n '360,460p' src/supervisor/supervisor-diagnostics-status-selection.test.ts`; `sed -n '1,260p' src/supervisor/supervisor.test.ts`; `rg -n "renderSupervisorStatusDto|github_rate_limit" src/supervisor/supervisor-status-rendering.test.ts src/supervisor/supervisor-status-rendering-supervisor.test.ts src/supervisor/supervisor-status-model-supervisor.test.ts src/supervisor/supervisor-status-model.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts`; `sed -n '1,260p' src/supervisor/supervisor-status-rendering.test.ts`; `sed -n '1,260p' src/supervisor/supervisor-status-rendering-supervisor.test.ts`; `sed -n '1,120p' src/supervisor/supervisor-diagnostics-status-selection.test.ts`; `sed -n '1,80p' src/supervisor/supervisor.test.ts`; `sed -n '1,220p' src/supervisor/supervisor-loop-runtime-state.ts`; `npx tsx --test src/supervisor/supervisor.test.ts`; `npx tsx --test src/supervisor/supervisor-diagnostics-status-selection.test.ts`; `rg -n "FULL_ISSUE_INVENTORY_REUSE_TTL_MS" src/supervisor/supervisor.ts src/supervisor -g'*.ts'`; `npm run build`; `ls`; `sed -n '1,220p' package.json`; `test -d node_modules && echo present || echo missing`; `npm ci`; `npm run build`; `git status --short`; `sed -n '1,120p' .codex-supervisor/issue-journal.md`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
