# Issue #800: WebUI contract hardening: expose typed issue collections and candidate-discovery summaries

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/800
- Branch: codex/issue-800
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: ea85ad819342afae6e1ceb094f3038e6f57e3a8c
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-21T22:22:54.251Z

## Latest Codex Summary
- None yet.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the remaining WebUI gap was that readiness and candidate-discovery context still crossed the backend boundary only as rendered strings, so the dashboard could not render tracked/blocked collections or discovery state without parsing free-form text.
- What changed: added typed `trackedIssues`, `runnableIssues`, `blockedIssues`, and `candidateDiscovery` fields to the status DTO; refactored readiness assembly to return typed collections plus legacy `readinessLines`; and updated the dashboard to render the typed collections and candidate-discovery summary first while preserving existing CLI/status-line text output.
- Current blocker: none
- Next exact step: commit the issue-800 checkpoint, push `codex/issue-800`, and open or update the draft PR for review.
- Verification gap: remote CI has not run on the issue-800 branch yet.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/backend/supervisor-http-server.test.ts`, `src/backend/webui-dashboard.test.ts`, `src/backend/webui-dashboard.ts`, `src/cli/supervisor-runtime.test.ts`, `src/supervisor/supervisor-diagnostics-status-selection.test.ts`, `src/supervisor/supervisor-selection-readiness-summary.ts`, `src/supervisor/supervisor-status-report.ts`, `src/supervisor/supervisor.ts`
- Rollback concern: keep typed readiness collections and legacy rendered lines derived from the same readiness builder so the dashboard DTO and CLI status text cannot drift independently.
- Last focused command: `npm run build`
- Last focused failure: `npm run build` initially failed with `sh: 1: tsc: not found`; running `npm ci` in this worktree installed the local toolchain and the follow-up build passed.
- Last focused commands:
```bash
npx tsx --test src/supervisor/supervisor-diagnostics-status-selection.test.ts src/backend/supervisor-http-server.test.ts src/backend/webui-dashboard.test.ts
npx tsx --test src/supervisor/supervisor-diagnostics-status-selection.test.ts src/backend/supervisor-http-server.test.ts src/backend/webui-dashboard.test.ts && npm run build
npm ci
npm run build
```
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
- Local dirt besides this work remains the pre-existing untracked `.codex-supervisor/replay/` directory.
- 2026-03-22T00:00:00Z: reproduced the issue with a new dashboard harness case that supplied typed tracked/blocked/candidate-discovery data but no legacy readiness lines; the dashboard rendered `No status lines reported.`
- 2026-03-22T00:00:00Z: refactored readiness assembly to emit typed runnable and blocked issue collections alongside the existing line-based summary, and added typed tracked issue DTOs plus typed candidate-discovery summary fields to `statusReport()`.
- 2026-03-22T00:00:00Z: focused verification passed; `npm run build` again needed a local `npm ci` because `tsc` was missing in this worktree.
