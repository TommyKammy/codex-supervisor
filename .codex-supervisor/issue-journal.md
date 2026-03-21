# Issue #801: WebUI read-only UX: improve issue navigation and inspection using typed backend models

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/801
- Branch: codex/issue-801
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 71637bd7ef178141643f76368f32fe4b82be5a45
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-21T23:04:44.203Z

## Latest Codex Summary
- Reproduced the remaining #801 gap with a focused WebUI dashboard test: typed runnable/blocked issue data rendered as passive text, so operators still had to type an issue number manually to inspect explain and issue-lint details.
- Added read-only typed issue shortcuts to the dashboard and wired them into the existing issue inspection flow without expanding the safe command surface.
- Focused verification passed after restoring local dependencies with `npm ci`.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: #801 was still incomplete because the dashboard exposed typed runnable/blocked/tracked issue models only as status text, leaving issue inspection dependent on manual issue-number entry.
- What changed: added a focused dashboard regression for typed shortcut-driven inspection, rendered read-only typed issue shortcut buttons from the status DTO, and wired those buttons into the existing explain/issue-lint loading path.
- Current blocker: none
- Next exact step: monitor draft PR #806 CI and address any review or verification failures on `codex/issue-801`.
- Verification gap: none locally; remote CI has not run on this checkpoint yet.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/backend/webui-dashboard.test.ts`, `src/backend/webui-dashboard.ts`
- Rollback concern: keep the shortcut strip read-only and sourced only from typed backend status fields so browser-side selection logic does not drift from supervisor behavior.
- Last focused command: `npm run build`
- Last focused failure: `dashboard_missing_typed_issue_shortcuts`; the dashboard lacked a typed issue picker and forced manual issue-number entry until the shortcut strip was added.
- Last focused commands:
```bash
npx tsx --test src/backend/webui-dashboard.test.ts
npx tsx --test src/backend/webui-dashboard.test.ts src/backend/supervisor-http-server.test.ts
npm ci
npm run build
```
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
- Local dirt besides this work remains the pre-existing untracked `.codex-supervisor/replay/` directory.
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
