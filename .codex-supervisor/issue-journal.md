# Issue #1500: Preserve the current Codex model config API while improving config UX

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1500
- Branch: codex/issue-1500
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 895b4920d51b13b742a45d4342fac586fdaeccc5
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-04-14T02:53:49.290Z

## Latest Codex Summary
- Added typed model-routing posture to setup readiness so invalid `fixed`/`alias` configs fail closed in setup, surfaced the posture in the setup shell, and added model-routing recipes to the configuration guide without changing the authoritative config field API.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: The main gap was not broken routing logic; it was that first-run setup and config docs did not make the current model-routing posture inspectable, and setup readiness could still look effectively configured even when `fixed`/`alias` routing was invalid due to a missing explicit model value.
- What changed: Added `modelRoutingPosture` to typed setup readiness, promoted missing explicit model values into fail-closed setup blockers, rendered the posture in the setup shell, and added copy-paste model-routing recipes plus explicit validation rules to `docs/configuration.md`.
- Current blocker: none
- Next exact step: Commit the focused readiness/docs/UI checkpoint on `codex/issue-1500`.
- Verification gap: None locally after focused tests and build; no PR/CI verification yet.
- Files touched: `.codex-supervisor/issue-journal.md`, `docs/configuration.md`, `src/setup-readiness.ts`, `src/setup-readiness.test.ts`, `src/backend/webui-setup-page.ts`, `src/backend/webui-setup-browser-script.ts`, `src/backend/webui-dashboard.test.ts`, `src/backend/supervisor-http-server.test.ts`, `src/backend/setup-test-fixtures.ts`, `src/config.test.ts`
- Rollback concern: Low; change is additive read-only posture/reporting plus docs/tests, but setup readiness now correctly blocks invalid model-routing configs that were previously under-reported.
- Last focused command: `npm run build`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
