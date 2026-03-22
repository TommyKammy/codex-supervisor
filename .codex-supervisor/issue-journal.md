# Issue #810: WebUI contract follow-up: expose typed operator activity context for richer issue detail views

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/810
- Branch: codex/issue-810
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 3 (implementation=2, repair=1)
- Last head SHA: 79a7ba773a1327cc03e7eb218d285cb44d19ffcb
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ8517qsQ|PRRT_kwDORgvdZ8517qsT
- Repeated failure signature count: 1
- Updated at: 2026-03-22T01:40:30.858Z

## Latest Codex Summary
Wired the dashboard issue detail pane to consume the new typed `activityContext` with legacy fallback, added a focused harness regression for it, pushed the follow-up commits, and opened draft PR [#816](https://github.com/TommyKammy/codex-supervisor/pull/816).

Summary: Dashboard now renders typed issue activity context, the follow-up is pushed on `codex/issue-810`, and draft PR #816 is open.
State hint: pr_open
Blocked reason: none
Tests: `npx tsx --test src/backend/webui-dashboard.test.ts`; `npm run build`
Failure signature: none
Next action: monitor draft PR #816 and address any CI or review feedback

## Active Failure Context
- Category: review
- Summary: 2 unresolved automated review thread(s) remain.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/816#discussion_r2970648871
- Details:
  - src/backend/webui-dashboard-browser-script.ts:103 _⚠️ Potential issue_ | _🟠 Major_ **Use typed `latestRecovery` as primary; legacy summary should be fallback only.** At Line 98-Line 100, legacy fallback is returned before checking `activityContext.latestRecovery`, so typed recovery data is skipped whenever both are present. <details> <summary>Proposed fix</summary> ```diff function formatLatestRecovery(activityContext, fallbackSummary) { - if (fallbackSummary) { - return fallbackSummary; - } const latestRecovery = activityContext && activityContext.latestRecovery; - if (!latestRecovery) { - return "none"; + if (latestRecovery) { + return ( + "issue=#" + + latestRecovery.issueNumber + + " at=" + + latestRecovery.at + + " reason=" + + latestRecovery.reason + + (latestRecovery.detail ? " detail=" + latestRecovery.detail : "") + ); } - return ( - "issue=#" + - latestRecovery.issueNumber + - " at=" + - latestRecovery.at + - " reason=" + - latestRecovery.reason + - (latestRecovery.detail ? " detail=" + latestRecovery.detail : "") - ); + if (fallbackSummary) { + return fallbackSummary; + } + return "none"; } ``` </details> <!-- suggestion_start --> <details> <summary>📝 Committable suggestion</summary> > ‼️ **IMPORTANT** > Carefully review the code before committing. Ensure that it accurately replaces the highlighted code, contains no missing lines, and has no issues with indentation. Thoroughly test & benchmark the code to ensure it meets the requirements. ```suggestion function formatLatestRecovery(activityContext, fallbackSummary) { const latestRecovery = activityContext && activityContext.latestRecovery; if (latestRecovery) { return ( "issue=#" + latestRecovery.issueNumber + " at=" + latestRecovery.at + " reason=" + latestRecovery.reason + (latestRecovery.detail ? " detail=" + latestRecovery.detail : "") ); } if (fallbackSummary) { return fallbackSummary; } return "none"; } ``` </details> <!-- suggestion_end --> <details> <summary>🤖 Prompt for AI Agents</summary> ``` Verify each finding against the current code and only fix it if needed. In `@src/backend/webui-dashboard-browser-script.ts` around lines 97 - 103, The function formatLatestRecovery currently returns fallbackSummary before checking activityContext.latestRecovery, causing typed latestRecovery to be ignored when both exist; update formatLatestRecovery so it first checks activityContext.latestRecovery (const latestRecovery = activityContext && activityContext.latestRecovery) and returns a formatted value from latestRecovery when present, only falling back to fallbackSummary if latestRecovery is falsy, and finally returning "none" when neither exists. ``` </details> <!-- fingerprinting:phantom:poseidon:hawk --> <!-- This is an auto-generated comment by CodeRabbit -->
  - src/supervisor/supervisor-selection-issue-explain.ts:203 _⚠️ Potential issue_ | _🔴 Critical_ **Guard PR resolution errors before building `activityContext`.** At Line 201-Line 203, a failure from `resolvePullRequestForBranch(...)` now aborts `buildIssueExplainDto`. This should degrade to `pr = null` instead of failing the explain response. <details> <summary>Proposed fix</summary> ```diff - const pr = record && github.resolvePullRequestForBranch - ? await github.resolvePullRequestForBranch(record.branch, record.pr_number) - : null; + let pr: GitHubPullRequest | null = null; + if (record && github.resolvePullRequestForBranch) { + try { + pr = await github.resolvePullRequestForBranch(record.branch, record.pr_number); + } catch { + pr = null; + } + } ``` </details> <!-- suggestion_start --> <details> <summary>📝 Committable suggestion</summary> > ‼️ **IMPORTANT** > Carefully review the code before committing. Ensure that it accurately replaces the highlighted code, contains no missing lines, and has no issues with indentation. Thoroughly test & benchmark the code to ensure it meets the requirements. ```suggestion let pr: GitHubPullRequest | null = null; if (record && github.resolvePullRequestForBranch) { try { pr = await github.resolvePullRequestForBranch(record.branch, record.pr_number); } catch { pr = null; } } ``` </details> <!-- suggestion_end --> <details> <summary>🤖 Prompt for AI Agents</summary> ``` Verify each finding against the current code and only fix it if needed. In `@src/supervisor/supervisor-selection-issue-explain.ts` around lines 201 - 203, The PR resolution call can throw and abort buildIssueExplainDto; wrap the await github.resolvePullRequestForBranch(...) call in a try/catch so errors are guarded and any failure sets pr = null (optionally log the error) before continuing to build the activityContext; specifically modify the assignment around resolvePullRequestForBranch to call it inside a try block and assign null in the catch, preserving the existing condition that uses record and github.resolvePullRequestForBranch. ``` </details> <!-- fingerprinting:phantom:poseidon:hawk --> <!-- This is an auto-generated comment by CodeRabbit -->

## Codex Working Notes
### Current Handoff
- Hypothesis: the remaining PR review blockers were both valid regressions, and the narrowest safe repair is to prioritize typed `latestRecovery` in the dashboard while fail-closing explain-side PR lookup to `null`.
- What changed: updated `src/backend/webui-dashboard-browser-script.ts` so typed `activityContext.latestRecovery` is rendered before the legacy fallback summary; wrapped `resolvePullRequestForBranch()` in `src/supervisor/supervisor-selection-issue-explain.ts` so explain DTO construction degrades to `pr = null` on lookup errors; tightened `src/backend/webui-dashboard.test.ts` to prove legacy recovery text is fallback-only; added a focused PR-lookup failure regression in `src/supervisor/supervisor-selection-issue-explain.test.ts`.
- Current blocker: none
- Next exact step: commit and push the review-fix checkpoint to `codex/issue-810`, then update PR #816 for the addressed CodeRabbit threads.
- Verification gap: none locally; the focused review-fix suite and `npm run build` both passed.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/backend/webui-dashboard-browser-script.ts`, `src/backend/webui-dashboard.test.ts`, `src/supervisor/supervisor-selection-issue-explain.test.ts`, `src/supervisor/supervisor-selection-issue-explain.ts`
- Rollback concern: `activityContext` is intentionally nullable for empty cases so older tests and consumers do not have to special-case empty objects; keep that behavior if the contract is reshaped.
- Last focused command: `npm run build`
- Last focused failure: `PRRT_kwDORgvdZ8517qsQ|PRRT_kwDORgvdZ8517qsT`; CodeRabbit flagged typed latest-recovery precedence and unguarded explain-side PR resolution.
- Last focused commands:
```bash
npx tsx --test src/backend/webui-dashboard.test.ts src/supervisor/supervisor-selection-issue-explain.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts src/backend/supervisor-http-server.test.ts
npm run build
```
### Scratchpad
- 2026-03-22T01:42:28Z: validated both CodeRabbit review threads as real regressions on `79a7ba7`, patched the dashboard to prefer typed latest-recovery data over the legacy summary, and guarded explain-side PR lookup failures by degrading to `pr = null`.
- 2026-03-22T01:42:28Z: focused verification passed with `npx tsx --test src/backend/webui-dashboard.test.ts src/supervisor/supervisor-selection-issue-explain.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts src/backend/supervisor-http-server.test.ts` and `npm run build`.
- 2026-03-22T00:00:00Z: reproduced missing rejection feedback with a confirm-decline dashboard case for prune workspaces; the browser returned early without a visible command result until declined confirmations were routed through a rejected-command renderer.
- 2026-03-22T00:00:00Z: focused verification passed with `npx tsx --test src/backend/webui-dashboard.test.ts`, `npx tsx --test src/backend/webui-dashboard.test.ts src/backend/supervisor-http-server.test.ts`, `npm ci`, and `npm run build`.
- 2026-03-21T23:43:40Z: reran the focused verification from the stabilizing checkpoint; `npx tsx --test src/backend/webui-dashboard.test.ts src/backend/supervisor-http-server.test.ts` and `npm run build` both passed on `f677ae4`.
- 2026-03-21T23:44:23Z: pushed `codex/issue-802` to origin and opened draft PR #807 (`https://github.com/TommyKammy/codex-supervisor/pull/807`) after the focused verification stayed green.
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
