# Issue #799: WebUI contract hardening: expose typed active-issue and selection summary fields in status DTOs

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/799
- Branch: codex/issue-799
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: draft_pr
- Attempt count: 2 (implementation=2, repair=0)
- Last head SHA: d42a7ab66d5f8ae494cf8d721bae4fc45af2d143
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-21T22:02:30Z

## Latest Codex Summary
Added typed `activeIssue` and `selectionSummary` fields to the status DTO, populated them from backend state/selection helpers, and kept legacy rendered status lines unchanged. The WebUI now prefers those typed fields for selected/active issue state and only falls back to line parsing for compatibility. I also added focused producer, HTTP, CLI, and dashboard tests, updated the issue journal, committed the checkpoint as `d42a7ab` (`Add typed active issue fields to status DTO`), pushed `codex/issue-799`, and opened draft PR #804.

Verification passed with:
`npx tsx --test src/supervisor/supervisor-status-model.test.ts src/cli/supervisor-runtime.test.ts src/backend/supervisor-http-server.test.ts`
`npx tsx --test src/supervisor/supervisor-diagnostics-status-selection.test.ts src/backend/webui-dashboard.test.ts`
`npm ci`
`npm run build`

Summary: Typed active-issue and selection-summary fields are now exposed in status DTOs, consumed by the WebUI, and covered by focused tests; checkpoint committed as `d42a7ab`.
State hint: draft_pr
Blocked reason: none
Tests: `npx tsx --test src/supervisor/supervisor-status-model.test.ts src/cli/supervisor-runtime.test.ts src/backend/supervisor-http-server.test.ts`; `npx tsx --test src/supervisor/supervisor-diagnostics-status-selection.test.ts src/backend/webui-dashboard.test.ts`; `npm ci`; `npm run build`
Failure signature: none
Next action: push `codex/issue-799` and open or update the branch PR with commit `d42a7ab`

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the missing contract hardening was isolated to the status DTO boundary and the dashboard client was still inferring selected/active issue state from rendered text.
- What changed: added typed `activeIssue` and `selectionSummary` fields to the status DTO, introduced a shared `buildSelectionSummary()` helper so typed fields and legacy `whyLines` stay in sync, and updated the dashboard to consume the typed fields first with legacy line parsing only as a fallback.
- Current blocker: none
- Next exact step: monitor PR #804 CI and address any review or check failures that appear.
- Verification gap: remote CI has not run locally in this workspace.
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
git push -u origin codex/issue-799
gh pr create --draft --base main --head codex/issue-799 --title "Expose typed active issue status fields" --body ...
```
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
- Local dirt besides this work remains the pre-existing untracked `.codex-supervisor/replay/` directory.
- 2026-03-21T21:46:00Z: reproduced the remaining gap with a dashboard harness case that returned typed `selectionSummary` data but no `whyLines`; the badge stayed `none` until the client stopped parsing lines.
- 2026-03-21T21:49:00Z: added a producer-side `statusReport()` assertion for typed `activeIssue` and `selectionSummary` while keeping the legacy rendered lines unchanged.
- 2026-03-21T21:50:16Z: final focused verification passed after `npm ci` restored the missing local `tsc` binary.
- 2026-03-21T22:02:30Z: pushed `codex/issue-799` to origin and opened draft PR #804 (`https://github.com/TommyKammy/codex-supervisor/pull/804`).
