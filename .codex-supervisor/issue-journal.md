# Issue #1039: WebUI hero shows duplicate 'Open Issue Details' actions for the same focused issue

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1039
- Branch: codex/issue-1039
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: a57e983b2058fb9646d63f49ab4342cde0f6bd0b
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-26T04:10:19.276Z

## Latest Codex Summary
- Reproduced the duplicate focused-issue hero action in the WebUI dashboard tests, then updated the browser-script hero action logic so the secondary hero button is hidden when it would duplicate the primary `Open Issue Details` action. Tightened the focused dashboard tests and verified with `npx tsx --test src/backend/webui-dashboard.test.ts` plus `npm run build`.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the dashboard hero action selection treats any focused issue as both the primary and secondary hero action target, so both buttons render `Open Issue Details` instead of suppressing the redundant secondary control.
- What changed: tightened the focused dashboard hero tests to require a single visible issue-details action; updated the browser script to mark the secondary hero action hidden when an issue is focused; added an `is-hidden` style for the secondary button and removed the stale static fallback label from the page template.
- Current blocker: none locally.
- Next exact step: commit the focused dashboard fix on `codex/issue-1039`, then open or update the draft PR for issue #1039 if needed.
- Verification gap: manual browser verification of the focused hero state is still not performed locally; automated focused dashboard coverage and `npm run build` passed.
- Files touched: `src/backend/webui-dashboard-browser-script.ts`, `src/backend/webui-dashboard-page.ts`, `src/backend/webui-dashboard.test.ts`, `.codex-supervisor/issue-journal.md`.
- Rollback concern: low; the behavior change is isolated to hero secondary-action rendering in the dashboard browser script plus focused tests.
- Last focused command: `npm run build`
- Exact failure reproduced: focused dashboard state rendered both `hero-primary-button` and `hero-secondary-button` with `Open Issue Details`, and the dashboard test suite explicitly expected the duplicate label in `src/backend/webui-dashboard.test.ts`.
- Commands run: `sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-1039/AGENTS.generated.md`; `sed -n '1,240p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-1039/context-index.md`; `sed -n '1,320p' .codex-supervisor/issue-journal.md`; `git status --short --branch`; `rg -n "Open Issue Details|hero-primary-button|hero-secondary-button|secondary action|primary action" src/backend/webui-dashboard-page.ts src/backend/webui-dashboard-browser-script.ts src/backend/webui-dashboard.test.ts`; `sed -n '1,260p' src/backend/webui-dashboard-page.ts`; `sed -n '1,340p' src/backend/webui-dashboard-browser-script.ts`; `sed -n '1,360p' src/backend/webui-dashboard.test.ts`; `sed -n '500,590p' src/backend/webui-dashboard-browser-script.ts`; `sed -n '900,990p' src/backend/webui-dashboard.test.ts`; `sed -n '1030,1075p' src/backend/webui-dashboard.test.ts`; `rg -n "heroSecondaryButton|heroPrimaryButton|applyHero|buildHero|issue-details" src/backend/webui-dashboard-browser-script.ts`; `rg -n "hidden =|\\.hidden|setAttribute\\(\\\"hidden|removeAttribute\\(\\\"hidden|display: none|is-hidden|visually-hidden" src/backend/webui-dashboard.test.ts src/backend/webui-dashboard-browser-script.ts src/backend/webui-dashboard-page.ts`; `rg -n "createDashboardHarness|FakeElement|FakeDocument|style =|style:" src/backend/webui-dashboard.test.ts`; `npx tsx --test src/backend/webui-dashboard.test.ts`; `git diff -- src/backend/webui-dashboard-browser-script.ts src/backend/webui-dashboard-page.ts src/backend/webui-dashboard.test.ts`; `npm ci`; `npm run build`; `date -u +"%Y-%m-%dT%H:%M:%SZ"`.
- PR status: none yet for `codex/issue-1039`.
### Scratchpad
- Leave `.codex-supervisor/replay/` untracked; it is local replay output, not part of the fix.
