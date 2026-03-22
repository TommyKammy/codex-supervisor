# Issue #841: WebUI guided setup flow: save through the narrow config API and revalidate in the browser

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/841
- Branch: codex/issue-841
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 3 (implementation=1, repair=2)
- Last head SHA: 38402005410687e4e10a9dec3a88515a570497a4
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 1
- Updated at: 2026-03-22T19:37:43Z

## Latest Codex Summary
Cleared the stale review metadata in [issue-journal.md](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-841/.codex-supervisor/issue-journal.md), committed it as `3840200`, pushed `codex/issue-841`, and resolved the two remaining journal-review threads on PR `#854`.

No product files changed in this pass. I revalidated the live smoke assertion with `rg`/`sed`, updated the snapshot to `Failure signature: none`, confirmed PR `#854` is still open on `codex/issue-841`, and left it in `UNSTABLE` while checks re-run on the latest push.

Summary: Pushed the journal-only review fix, resolved the remaining stale review threads, and left PR `#854` waiting on CI.
State hint: waiting_ci
Blocked reason: none
Tests: Not run in this pass; revalidated `src/backend/webui-dashboard-browser-smoke.test.ts` via focused `rg`/`sed` inspection because only `.codex-supervisor/issue-journal.md` changed.
Failure signature: none
Next action: Monitor PR `#854` for any new CI or review feedback now that commit `3840200` is pushed and the stale threads are resolved.

## Active Failure Context
- Category: none
- Summary: No active failures; review threads resolved on 2026-03-22T19:21:07Z.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/854
- Details: none

## Codex Working Notes
### Current Handoff
- Hypothesis: the setup shell can stay narrow and safe by rendering editable inputs from typed readiness metadata, sending only accepted setup fields to `/api/setup-config`, and then treating a second `/api/setup-readiness` fetch as the source of truth for the refreshed UI.
- What changed: added a guided config form to the setup page, explicit `saving` and `revalidating` status text in the browser script, a focused browser-harness regression that proves the POST plus follow-up GET sequence, and a live Playwright smoke test that completes the first-run path through the real HTTP fixture. During review follow-up, I corrected the smoke-test readiness expectation to the actual two-fetch flow, updated the journal handoff to reference existing PR `#854`, pushed commit `44e5285`, resolved the two addressed CodeRabbit threads on PR `#854`, and then cleared the stale journal-only failure metadata after confirming the smoke assertion was already correct in-tree.
- Current blocker: none
- Next exact step: monitor PR `#854` for any fresh CI or reviewer feedback and respond only if new issues appear after the journal-only cleanup lands.
- Verification gap: none on the local diff; the issue verification command and `npm run build` both passed for the review-fix state.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/backend/webui-dashboard-browser-smoke.test.ts`, `src/backend/webui-dashboard.test.ts`, `src/backend/webui-setup-browser-script.ts`, `src/backend/webui-setup-page.ts`
- Rollback concern: medium-low; the change is isolated to the setup shell and its tests, but the browser script now owns input rendering and save state so regressions would affect first-run setup UX directly.
- Last focused command: `gh api graphql -f query='mutation { first: resolveReviewThread(input: {threadId: "PRRT_kwDORgvdZ851_eJT"}) { thread { id isResolved } } second: resolveReviewThread(input: {threadId: "PRRT_kwDORgvdZ851_eJV"}) { thread { id isResolved } } }'`
- Last focused failure: none.
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
rg -n "readinessCalls|setup-readiness|bootstrap|handleSetupSubmit|querySetupReadiness|refreshSetupReadiness" src/backend/webui-dashboard-browser-smoke.test.ts src/backend/webui-setup-browser-script.ts
sed -n '500,560p' src/backend/webui-dashboard-browser-smoke.test.ts
sed -n '1,220p' src/backend/webui-setup-browser-script.ts
sed -n '220,460p' src/backend/webui-setup-browser-script.ts
npx tsx --test src/backend/webui-dashboard-browser-logic.test.ts src/backend/webui-dashboard.test.ts src/backend/webui-dashboard-browser-smoke.test.ts
npm run build
date -u +%Y-%m-%dT%H:%M:%SZ
git push origin codex/issue-841
gh pr view 854 --json url,isDraft,number,state,headRefName,mergeStateStatus
gh api graphql -f query='mutation { first: resolveReviewThread(input: {threadId: "PRRT_kwDORgvdZ851_aJE"}) { thread { id isResolved } } second: resolveReviewThread(input: {threadId: "PRRT_kwDORgvdZ851_aJG"}) { thread { id isResolved } } }'
git diff -- .codex-supervisor/issue-journal.md
rg -n "readinessCalls\\.length|readinessCalls" src/backend/webui-dashboard-browser-smoke.test.ts
sed -n '520,548p' src/backend/webui-dashboard-browser-smoke.test.ts
find .codex-supervisor/replay -maxdepth 2 -type f | sort
date -u +%Y-%m-%dT%H:%M:%SZ
git add .codex-supervisor/issue-journal.md
git commit -m "docs: clear stale setup review journal state"
git rev-parse HEAD
git push origin codex/issue-841
gh api graphql -f query='mutation { first: resolveReviewThread(input: {threadId: "PRRT_kwDORgvdZ851_eJT"}) { thread { id isResolved } } second: resolveReviewThread(input: {threadId: "PRRT_kwDORgvdZ851_eJV"}) { thread { id isResolved } } }'
gh pr view 854 --json url,isDraft,number,state,headRefName,mergeStateStatus
date -u +%Y-%m-%dT%H:%M:%SZ
```
### Scratchpad
- 2026-03-22T19:37:43Z: committed the journal-only cleanup as `3840200`, pushed `codex/issue-841`, resolved review threads `PRRT_kwDORgvdZ851_eJT` and `PRRT_kwDORgvdZ851_eJV`, and confirmed PR `#854` remains open with merge state `UNSTABLE` while checks re-run.
- 2026-03-22T19:35:04Z: confirmed `src/backend/webui-dashboard-browser-smoke.test.ts` already asserts `readinessCalls.length >= 2`, so the product-code CodeRabbit note was stale; the remaining valid work was clearing stale failure metadata from `.codex-supervisor/issue-journal.md`.
- 2026-03-22T19:35:04Z: updated the journal snapshot to `Last failure signature: none` and replaced the stale active review-failure block with a resolved `Category: none` entry tied to PR `#854`.
- 2026-03-22T19:21:07Z: pushed review-fix commit `44e5285` to `codex/issue-841`, confirmed PR `#854` is open and `CLEAN`, and resolved the two addressed CodeRabbit review threads via GraphQL.
- 2026-03-22T19:21:07Z: validated both CodeRabbit findings against the current branch, lowered the first-run smoke assertion from `readinessCalls.length >= 3` to `>= 2` to match the browser's bootstrap-plus-post-save fetch pattern, updated the journal handoff to reference existing PR `#854`, and reran the issue verification command plus `npm run build` successfully.
- 2026-03-22T19:07:13Z: added the setup-form browser regression, implemented the guided setup editor and save-status flow in the setup page/browser script, added a Playwright smoke test that completes first-run setup through `/api/setup-config`, restored missing `playwright-core` via `npm ci`, and reran the issue verification command plus `npm run build` successfully.
- 2026-03-22T18:35:16Z: reproduced the PR build failure locally with `npm run build` as `TS2769` in `src/config.test.ts(883,55)`, added a non-null assertion via `assert.ok(result.backupPath, ...)`, reran `npm run build` plus the issue verification command successfully, and pushed repair commit `d3f451f` to PR `#853`.
- 2026-03-22T10:56:27Z: `git merge --no-edit origin/main` reported a single content conflict in `.codex-supervisor/issue-journal.md`; all product code and tests from `origin/main` merged without manual intervention.
- 2026-03-22T10:56:27Z: resolved the journal conflict by restoring the issue-824 journal content and updating it for the current merge-resolution pass instead of taking `main`'s unrelated issue-829 journal.
- 2026-03-22T10:56:27Z: focused merge verification passed with `npx tsx --test src/backend/webui-dashboard.test.ts src/backend/webui-dashboard-browser-logic.test.ts src/backend/supervisor-http-server.test.ts src/supervisor/supervisor-service.test.ts src/getting-started-docs.test.ts src/doctor.test.ts` and `npm run build`.
- 2026-03-22T08:57:53Z: fixed the remaining shortcut-strip leak by switching tracked shortcut collection to `collectTrackedIssues(status)`, which keeps tracked `done` issues out of the default Issue Details shortcuts while leaving them available behind the tracked-history toggle.
- 2026-03-22T08:57:53Z: added focused regressions in `src/backend/webui-dashboard-browser-logic.test.ts` and `src/backend/webui-dashboard.test.ts`; `npx tsx --test src/backend/webui-dashboard.test.ts src/backend/webui-dashboard-browser-logic.test.ts` and `npm run build` both passed on the local diff.
- 2026-03-22T06:48:38+00:00: initial `npm run build` failed because `tsc` was missing in this worktree; restored dependencies with `npm ci`, reran the focused tests, and `npm run build` then passed.
