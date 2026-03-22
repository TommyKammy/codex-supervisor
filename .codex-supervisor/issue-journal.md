# Issue #841: WebUI guided setup flow: save through the narrow config API and revalidate in the browser

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/841
- Branch: codex/issue-841
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: daf039a6a8fd53658c858295133ce1689862f226
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-22T19:07:13Z

## Latest Codex Summary
- Added a guided first-run setup editor to the setup page, posting typed changes only to `/api/setup-config` and then re-fetching `/api/setup-readiness` so the browser shows save and revalidation state explicitly.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the setup shell can stay narrow and safe by rendering editable inputs from typed readiness metadata, sending only accepted setup fields to `/api/setup-config`, and then treating a second `/api/setup-readiness` fetch as the source of truth for the refreshed UI.
- What changed: added a guided config form to the setup page, explicit `saving` and `revalidating` status text in the browser script, a focused browser-harness regression that proves the POST plus follow-up GET sequence, and a live Playwright smoke test that completes the first-run path through the real HTTP fixture.
- Current blocker: none
- Next exact step: commit the guided setup-flow checkpoint, push `codex/issue-841`, and open a draft PR because no PR exists for this branch yet.
- Verification gap: none on the local diff; the issue verification command and `npm run build` both passed after restoring dependencies with `npm ci`.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/backend/webui-dashboard-browser-smoke.test.ts`, `src/backend/webui-dashboard.test.ts`, `src/backend/webui-setup-browser-script.ts`, `src/backend/webui-setup-page.ts`
- Rollback concern: medium-low; the change is isolated to the setup shell and its tests, but the browser script now owns input rendering and save state so regressions would affect first-run setup UX directly.
- Last focused command: `npm run build`
- Last focused failure: `npx tsx --test src/backend/webui-dashboard-browser-logic.test.ts src/backend/webui-dashboard.test.ts src/backend/webui-dashboard-browser-smoke.test.ts` initially failed with `Error: Cannot find module 'playwright-core'`; running `npm ci` restored the missing dependency and the focused verification then passed.
- Last focused commands:
```bash
sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-841/AGENTS.generated.md
sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-841/context-index.md
sed -n '1,260p' .codex-supervisor/issue-journal.md
git status --short --branch
rg -n "setup|revalidate|reviewProvider|reviewBotLogins|narrow" src/backend src
sed -n '1,260p' src/backend/webui-setup-browser-script.ts
sed -n '1,240p' src/backend/supervisor-http-server.ts
sed -n '1,260p' src/setup-config-write.ts
sed -n '1,260p' src/backend/webui-dashboard-browser-smoke.test.ts
sed -n '1,260p' src/backend/webui-dashboard.test.ts
sed -n '1,260p' src/backend/webui-setup-page.ts
sed -n '1,240p' docs/getting-started.md
npx tsx --test src/backend/webui-dashboard.test.ts --test-name-pattern "setup shell saves through the narrow setup config API and revalidates readiness after the write"
npx tsx --test src/backend/webui-dashboard.test.ts --test-name-pattern "setup shell (loads|saves)"
npx tsx --test src/backend/webui-dashboard-browser-logic.test.ts src/backend/webui-dashboard.test.ts src/backend/webui-dashboard-browser-smoke.test.ts
npm ci
npm run build
date -u +%Y-%m-%dT%H:%M:%SZ
gh pr view --json url,isDraft,number,state,headRefName,mergeStateStatus
```
### Scratchpad
- 2026-03-22T19:07:13Z: added the setup-form browser regression, implemented the guided setup editor and save-status flow in the setup page/browser script, added a Playwright smoke test that completes first-run setup through `/api/setup-config`, restored missing `playwright-core` via `npm ci`, and reran the issue verification command plus `npm run build` successfully.
- 2026-03-22T18:35:16Z: reproduced the PR build failure locally with `npm run build` as `TS2769` in `src/config.test.ts(883,55)`, added a non-null assertion via `assert.ok(result.backupPath, ...)`, reran `npm run build` plus the issue verification command successfully, and pushed repair commit `d3f451f` to PR `#853`.
- 2026-03-22T10:56:27Z: `git merge --no-edit origin/main` reported a single content conflict in `.codex-supervisor/issue-journal.md`; all product code and tests from `origin/main` merged without manual intervention.
- 2026-03-22T10:56:27Z: resolved the journal conflict by restoring the issue-824 journal content and updating it for the current merge-resolution pass instead of taking `main`'s unrelated issue-829 journal.
- 2026-03-22T10:56:27Z: focused merge verification passed with `npx tsx --test src/backend/webui-dashboard.test.ts src/backend/webui-dashboard-browser-logic.test.ts src/backend/supervisor-http-server.test.ts src/supervisor/supervisor-service.test.ts src/getting-started-docs.test.ts src/doctor.test.ts` and `npm run build`.
- 2026-03-22T08:57:53Z: fixed the remaining shortcut-strip leak by switching tracked shortcut collection to `collectTrackedIssues(status)`, which keeps tracked `done` issues out of the default Issue Details shortcuts while leaving them available behind the tracked-history toggle.
- 2026-03-22T08:57:53Z: added focused regressions in `src/backend/webui-dashboard-browser-logic.test.ts` and `src/backend/webui-dashboard.test.ts`; `npx tsx --test src/backend/webui-dashboard.test.ts src/backend/webui-dashboard-browser-logic.test.ts` and `npm run build` both passed on the local diff.
- 2026-03-22T06:48:38+00:00: initial `npm run build` failed because `tsc` was missing in this worktree; restored dependencies with `npm ci`, reran the focused tests, and `npm run build` then passed.
