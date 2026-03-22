# Issue #841: WebUI guided setup flow: save through the narrow config API and revalidate in the browser

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/841
- Branch: codex/issue-841
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 2 (implementation=1, repair=1)
- Last head SHA: 18b80f6d496d95c2bc617423844d4afd2f5a2e1a
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ851_aJE|PRRT_kwDORgvdZ851_aJG
- Repeated failure signature count: 1
- Updated at: 2026-03-22T19:19:40.616Z

## Latest Codex Summary
Added a guided setup editor to the setup shell so first-run fields can be saved from the browser through the narrow `/api/setup-config` API, with explicit `saving`, `revalidating`, success, and failure status text. The browser now re-fetches `/api/setup-readiness` after each accepted write and re-renders the refreshed blockers/readiness state instead of trusting the POST response alone. I also added a focused harness regression for the POST-plus-revalidation flow and a live Playwright smoke test for the first-run path.

Key changes are in [src/backend/webui-setup-page.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-841/src/backend/webui-setup-page.ts), [src/backend/webui-setup-browser-script.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-841/src/backend/webui-setup-browser-script.ts), [src/backend/webui-dashboard.test.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-841/src/backend/webui-dashboard.test.ts), and [src/backend/webui-dashboard-browser-smoke.test.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-841/src/backend/webui-dashboard-browser-smoke.test.ts). I committed this as `18b80f6` and opened draft PR `#854`: https://github.com/TommyKammy/codex-supervisor/pull/854

Summary: Added guided WebUI setup save/revalidation flow, focused regression coverage, and first-run browser smoke coverage; pushed `codex/issue-841` and opened draft PR #854.
State hint: draft_pr
Blocked reason: none
Tests: `npx tsx --test src/backend/webui-dashboard-browser-logic.test.ts src/backend/webui-dashboard.test.ts src/backend/webui-dashboard-browser-smoke.test.ts`; `npm run build`
Failure signature: none
Next action: Monitor draft PR #854 CI and address any review or stabilization feedback.

## Active Failure Context
- Category: review
- Summary: 2 unresolved automated review thread(s) remain.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/854#discussion_r2971945420
- Details:
  - .codex-supervisor/issue-journal.md:27 _⚠️ Potential issue_ | _🟡 Minor_ **Update stale PR-status handoff text.** Line 27 says no PR exists yet, but this branch already has PR `#854` open. Please update this step to avoid misleading the next handoff/operator. <details> <summary>🤖 Prompt for AI Agents</summary> ``` Verify each finding against the current code and only fix it if needed. In @.codex-supervisor/issue-journal.md at line 27, Update the stale handoff sentence that currently reads "open a draft PR because no PR exists for this branch yet" in the guided setup-flow checkpoint; replace it to reference the existing PR number (PR `#854`) and instruct to update or mention the existing PR instead of creating a new one so the next operator isn't misled. ``` </details> <!-- fingerprinting:phantom:triton:hawk --> <!-- This is an auto-generated comment by CodeRabbit -->
  - src/backend/webui-dashboard-browser-smoke.test.ts:539 _⚠️ Potential issue_ | _🟡 Minor_ <details> <summary>🧩 Analysis chain</summary> 🏁 Script executed: ```shell #!/bin/bash # Check the browser script to understand when /api/setup-readiness is called rg -n "setup-readiness" src/backend/webui-setup-browser-script.ts ``` Repository: TommyKammy/codex-supervisor Length of output: 137 --- 🏁 Script executed: ```shell #!/bin/bash # First, let's look at the test file to understand readinessCalls and how it's tracked cd src/backend wc -l webui-dashboard-browser-smoke.test.ts ``` Repository: TommyKammy/codex-supervisor Length of output: 112 --- 🏁 Script executed: ```shell #!/bin/bash # Look at the test context around lines 537-539 sed -n '500,550p' src/backend/webui-dashboard-browser-smoke.test.ts ``` Repository: TommyKammy/codex-supervisor Length of output: 1549 --- 🏁 Script executed: ```shell #!/bin/bash # Search for readinessCalls definition and usage in the test file rg -n "readinessCalls" src/backend/webui-dashboard-browser-smoke.test.ts -B 5 -A 2 ``` Repository: TommyKammy/codex-supervisor Length of output: 1271 --- 🏁 Script executed: ```shell #!/bin/bash # Check for all calls related to setup-readiness in the browser script rg -n "setup-readiness|readJson|fetch" src/backend/webui-setup-browser-script.ts | head -30 ``` Repository: TommyKammy/codex-supervisor Length of output: 320 --- 🏁 Script executed: ```shell #!/bin/bash # Look at the context around the readiness call in browser script sed -n '350,400p' src/backend/webui-setup-browser-script.ts ``` Repository: TommyKammy/codex-supervisor Length of output: 1684 --- 🏁 Script executed: ```shell #!/bin/bash # Search for polling or interval-based calls to readiness rg -n "setInterval|setTimeout|poll" src/backend/webui-setup-browser-script.ts ``` Repository: TommyKammy/codex-supervisor Length of output: 53 --- 🏁 Script executed: ```shell #!/bin/bash # Look for initialization code that might trigger readiness checks rg -n "refreshSetupReadiness|querySetupReadiness" src/backend/webui-setup-browser-script.ts -B 3 -A 3 ``` Repository: TommyKammy/codex-supervisor Length of output: 1125 --- 🏁 Script executed: ```shell #!/bin/bash # Get full file to understand initialization flow better wc -l src/backend/webui-setup-browser-script.ts ``` Repository: TommyKammy/codex-supervisor Length of output: 116 --- 🏁 Script executed: ```shell #!/bin/bash # Look at the beginning/initialization of the browser script head -100 src/backend/webui-setup-browser-script.ts ``` Repository: TommyKammy/codex-supervisor Length of output: 3930 --- 🏁 Script executed: ```shell #!/bin/bash # Look for all document event listeners or DOMContentLoaded rg -n "addEventListener|DOMContentLoaded|onload" src/backend/webui-setup-browser-script.ts -B 2 -A 2 ``` Repository: TommyKammy/codex-supervisor Length of output: 288 --- 🏁 Script executed: ```shell #!/bin/bash # Look at the very end of the script to see initialization flow tail -100 src/backend/webui-setup-browser-script.ts ``` Repository: TommyKammy/codex-supervisor Length of output: 3674 --- </details> **Change `readinessCalls.length >= 3` to `readinessCalls.length >= 2`.** The browser script calls `/api/setup-readiness` exactly twice in this flow: 1. During `bootstrap()` initialization (line 417) 2. After the form is saved in `handleSetupSubmit()` (line 400) There is no polling or additional mechanism that triggers a third call. The `>= 3` assertion is overly strict and will cause flakiness. <details> <summary>🤖 Prompt for AI Agents</summary> ``` Verify each finding against the current code and only fix it if needed. In `@src/backend/webui-dashboard-browser-smoke.test.ts` around lines 537 - 539, Update the test assertion that checks readinessCalls so it expects at least two calls instead of three: locate the assertion using the readinessCalls variable (the line currently asserting readinessCalls.length >= 3) and change it to readinessCalls.length >= 2 to match the actual calls made by bootstrap() and handleSetupSubmit(). ``` </details> <!-- fingerprinting:phantom:medusa:ocelot --> <!-- This is an auto-generated comment by CodeRabbit -->

## Codex Working Notes
### Current Handoff
- Hypothesis: the setup shell can stay narrow and safe by rendering editable inputs from typed readiness metadata, sending only accepted setup fields to `/api/setup-config`, and then treating a second `/api/setup-readiness` fetch as the source of truth for the refreshed UI.
- What changed: added a guided config form to the setup page, explicit `saving` and `revalidating` status text in the browser script, a focused browser-harness regression that proves the POST plus follow-up GET sequence, and a live Playwright smoke test that completes the first-run path through the real HTTP fixture. During review follow-up, I corrected the smoke-test readiness expectation to the actual two-fetch flow, updated the journal handoff to reference existing PR `#854`, pushed commit `44e5285`, and resolved the two addressed CodeRabbit threads on PR `#854`.
- Current blocker: none
- Next exact step: monitor PR `#854` for any fresh CI or reviewer feedback and respond only if new issues appear.
- Verification gap: none on the local diff; the issue verification command and `npm run build` both passed for the review-fix state.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/backend/webui-dashboard-browser-smoke.test.ts`, `src/backend/webui-dashboard.test.ts`, `src/backend/webui-setup-browser-script.ts`, `src/backend/webui-setup-page.ts`
- Rollback concern: medium-low; the change is isolated to the setup shell and its tests, but the browser script now owns input rendering and save state so regressions would affect first-run setup UX directly.
- Last focused command: `gh api graphql -f query='mutation { first: resolveReviewThread(input: {threadId: "PRRT_kwDORgvdZ851_aJE"}) { thread { id isResolved } } second: resolveReviewThread(input: {threadId: "PRRT_kwDORgvdZ851_aJG"}) { thread { id isResolved } } }'`
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
```
### Scratchpad
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
