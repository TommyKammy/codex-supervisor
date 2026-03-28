# Issue #1143: Avoid duplicate Open Queue Details hero actions in the WebUI dashboard

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1143
- Branch: codex/issue-1143
- Workspace: .
- Journal: .codex-supervisor/issues/1143/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: dbce5077f9abffec6e9fe31497d05985dc072d6f
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-28T00:12:25.451Z

## Latest Codex Summary
- Added a focused dashboard regression for the healthy no-focused-issue state and fixed hero secondary-action selection so queue navigation is not duplicated when it is already the primary fallback.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: The duplicate hero buttons come from both primary and secondary action selectors independently falling back to the same queue action when refresh is healthy, doctor passes, and there is no focused issue.
- What changed: Added a regression test for the no-focused-issue healthy dashboard state and changed the secondary hero-action selector to hide itself when the primary action already resolves to queue navigation.
- Current blocker: none
- Next exact step: Commit the focused fix on `codex/issue-1143`; manual browser verification is still optional if required later.
- Verification gap: Did not run manual WebUI verification against `dist/index.js web`; only the focused dashboard test file was run.
- Files touched: src/backend/webui-dashboard.test.ts; src/backend/webui-dashboard-browser-script.ts; .codex-supervisor/issues/1143/issue-journal.md
- Rollback concern: Low; behavior change is limited to secondary hero-button visibility when queue navigation is already the primary action.
- Last focused command: npx tsx --test src/backend/webui-dashboard.test.ts
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
