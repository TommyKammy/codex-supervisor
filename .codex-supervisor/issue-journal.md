# Issue #799: WebUI contract hardening: expose typed active-issue and selection summary fields in status DTOs

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/799
- Branch: codex/issue-799
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Current phase: stabilizing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 0fc8cad80170d3387f26a5c32d5cc3f03276491b
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-21T21:50:16Z

## Latest Codex Summary
- Added typed `activeIssue` and `selectionSummary` fields to `SupervisorStatusDto`, populated them from shared backend selection/status helpers, and switched the WebUI to prefer those fields instead of parsing status lines. Focused DTO, CLI, producer, and dashboard tests pass; `npm run build` also passes after installing local dependencies with `npm ci`.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the missing contract hardening was isolated to the status DTO boundary and the dashboard client was still inferring selected/active issue state from rendered text.
- What changed: added typed `activeIssue` and `selectionSummary` fields to the status DTO, introduced a shared `buildSelectionSummary()` helper so typed fields and legacy `whyLines` stay in sync, and updated the dashboard to consume the typed fields first with legacy line parsing only as a fallback.
- Current blocker: none
- Next exact step: commit this checkpoint on `codex/issue-799`, then open or update the branch PR if one does not already exist for this issue.
- Verification gap: none beyond remote CI.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/backend/supervisor-http-server.test.ts`, `src/backend/webui-dashboard.test.ts`, `src/backend/webui-dashboard.ts`, `src/cli/supervisor-runtime.test.ts`, `src/supervisor/supervisor-diagnostics-status-selection.test.ts`, `src/supervisor/supervisor-selection-readiness-summary.ts`, `src/supervisor/supervisor-status-report.ts`, `src/supervisor/supervisor.ts`
- Rollback concern: keep `selectionSummary` derived from the shared backend selector so typed fields and legacy rendered lines cannot drift independently.
- Last focused command: `npm run build`
- Last focused failure: `npm run build` initially failed with `sh: 1: tsc: not found`; running `npm ci` in this worktree installed the local toolchain and the follow-up build passed.
- Last focused commands:
```bash
npx tsx --test src/supervisor/supervisor-status-model.test.ts src/cli/supervisor-runtime.test.ts src/backend/supervisor-http-server.test.ts
npx tsx --test src/supervisor/supervisor-diagnostics-status-selection.test.ts src/backend/webui-dashboard.test.ts
npm ci
npm run build
```
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
- Local dirt besides this work remains the pre-existing untracked `.codex-supervisor/replay/` directory.
- 2026-03-21T21:46:00Z: reproduced the remaining gap with a dashboard harness case that returned typed `selectionSummary` data but no `whyLines`; the badge stayed `none` until the client stopped parsing lines.
- 2026-03-21T21:49:00Z: added a producer-side `statusReport()` assertion for typed `activeIssue` and `selectionSummary` while keeping the legacy rendered lines unchanged.
- 2026-03-21T21:50:16Z: final focused verification passed after `npm ci` restored the missing local `tsc` binary.
