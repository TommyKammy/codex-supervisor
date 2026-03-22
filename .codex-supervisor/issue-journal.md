# Issue #813: WebUI operator timeline: correlate safe-command results with live supervisor events

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/813
- Branch: codex/issue-813
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 5 (implementation=1, repair=4)
- Last head SHA: c8313f1662d280859d7f896338c748cbd3caffce
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 1
- Updated at: 2026-03-22T04:15:25Z

## Latest Codex Summary
Updated [webui-dashboard-browser-logic.ts](src/backend/webui-dashboard-browser-logic.ts) so `describeTimelineEvent()` picks the first non-empty trimmed label from `summary`, `message`, or `type` instead of accepting `""` as a valid operator-timeline entry. Added focused regressions in [webui-dashboard-browser-logic.test.ts](src/backend/webui-dashboard-browser-logic.test.ts) that cover whitespace-only label fields and the `"event"` fallback.

Committed `c8313f1` (`Prevent blank dashboard timeline labels`) and pushed `codex/issue-813`. `gh pr view 819 --json number,state,isDraft,url,mergeStateStatus,reviewDecision,headRefName,headRefOid,baseRefName` now shows PR #819 open on head `c8313f1662d280859d7f896338c748cbd3caffce` with merge state `UNSTABLE` while checks rerun, and `gh api graphql` reports review thread `PRRT_kwDORgvdZ8518N2O` resolved/outdated.

Summary: Fixed the last open CodeRabbit review thread for blank timeline labels, verified it locally, and pushed PR #819 to head `c8313f1`
State hint: waiting_ci
Blocked reason: none
Tests: `npx tsx --test src/backend/webui-dashboard.test.ts src/backend/webui-dashboard-browser-logic.test.ts src/backend/supervisor-http-server.test.ts`; `npm run build`
Failure signature: none
Next action: monitor PR #819 for CI completion on `c8313f1` and handle any new review feedback if checks or bots surface more issues

## Active Failure Context
- Category: none
- Summary: No active local failure remains; the previously open CodeRabbit thread for blank timeline labels is resolved on GitHub after `c8313f1`.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/819#discussion_r2970850775
- Details:
  - `gh api graphql -f query='query { repository(owner:"TommyKammy", name:"codex-supervisor") { pullRequest(number:819) { reviewThreads(first:50) { nodes { id isResolved isOutdated path } } } } }'` reported `PRRT_kwDORgvdZ8518N2O` as `isResolved: true` and `isOutdated: true` after the push.
  - `gh pr view 819 --json number,state,isDraft,url,mergeStateStatus,reviewDecision,headRefName,headRefOid,baseRefName` reports merge state `UNSTABLE` on the new head while CI reruns.

## Codex Working Notes
### Current Handoff
- Hypothesis: the last CodeRabbit thread was correct because `describeTimelineEvent()` treated empty strings as valid labels and could render a blank operator-timeline row.
- What changed: switched the default event-label fallback to the first non-empty trimmed value among `summary`, `message`, and `type`, added regressions for whitespace-only labels and the `"event"` fallback, committed the fix as `c8313f1` (`Prevent blank dashboard timeline labels`), pushed `codex/issue-813`, and confirmed the GitHub thread is resolved/outdated.
- Current blocker: none
- Next exact step: monitor PR #819 (`https://github.com/TommyKammy/codex-supervisor/pull/819`) for CI/check settlement on head `c8313f1` and react only if new review feedback appears.
- Verification gap: none locally; remaining uncertainty is limited to CI and any follow-on bot review after the new head.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/backend/webui-dashboard-browser-logic.test.ts`, `src/backend/webui-dashboard-browser-logic.ts`
- Rollback concern: keep the label trimming scoped to the default fallback path so known typed supervisor-event summaries remain unchanged.
- Last focused command: `gh api graphql -f query='query { repository(owner:"TommyKammy", name:"codex-supervisor") { pullRequest(number:819) { reviewThreads(first:50) { nodes { id isResolved isOutdated path } } } } }'`
- Last focused failure: none
- Last focused commands:
```bash
npx tsx --test src/backend/webui-dashboard.test.ts src/backend/webui-dashboard-browser-logic.test.ts src/backend/supervisor-http-server.test.ts
npm run build
git commit -m "Prevent blank dashboard timeline labels"
git push origin codex/issue-813
gh pr view 819 --json number,state,isDraft,url,mergeStateStatus,reviewDecision,headRefName,headRefOid,baseRefName
gh api graphql -f query='query { repository(owner:"TommyKammy", name:"codex-supervisor") { pullRequest(number:819) { reviewThreads(first:50) { nodes { id isResolved isOutdated path } } } } }'
```
### Scratchpad
- 2026-03-22T04:15:25Z: validated CodeRabbit thread `PRRT_kwDORgvdZ8518N2O`; changed `describeTimelineEvent()` to ignore empty/whitespace-only label fields, added focused regressions for trimmed fallback behavior, passed `npx tsx --test src/backend/webui-dashboard.test.ts src/backend/webui-dashboard-browser-logic.test.ts src/backend/supervisor-http-server.test.ts` and `npm run build`, committed `c8313f1` (`Prevent blank dashboard timeline labels`), pushed `codex/issue-813`, and confirmed via `gh api graphql` that the thread is resolved/outdated.
- 2026-03-22T03:28:21Z: focused verification passed with `npx tsx --test src/backend/webui-dashboard-browser-logic.test.ts src/backend/webui-dashboard.test.ts src/backend/supervisor-http-server.test.ts` and `npm run build` after `npm ci` restored `tsc` in this worktree.
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
