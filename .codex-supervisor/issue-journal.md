# Issue #813: WebUI operator timeline: correlate safe-command results with live supervisor events

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/813
- Branch: codex/issue-813
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 2 (implementation=1, repair=1)
- Last head SHA: 738b0fd2bdcea010c5f59d0ca822299c36636417
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ8518BXw
- Repeated failure signature count: 1
- Updated at: 2026-03-22T12:46:24+09:00

## Latest Codex Summary
Added a browser-only operator timeline that renders safe-command results, post-command refresh deltas, and correlated SSE events in one bounded feed. The main behavior lives in [webui-dashboard-browser-script.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-813/src/backend/webui-dashboard-browser-script.ts) with summary helpers in [webui-dashboard-browser-logic.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-813/src/backend/webui-dashboard-browser-logic.ts) and the new panel in [webui-dashboard-page.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-813/src/backend/webui-dashboard-page.ts). Focused regressions were added in [webui-dashboard.test.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-813/src/backend/webui-dashboard.test.ts), [webui-dashboard-browser-logic.test.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-813/src/backend/webui-dashboard-browser-logic.test.ts), and [supervisor-http-server.test.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-813/src/backend/supervisor-http-server.test.ts).

Committed `96f3858` and the journal follow-up `5f09f14`, pushed `codex/issue-813`, and opened draft PR #819: https://github.com/TommyKammy/codex-supervisor/pull/819. Local verification passed after `npm ci` restored `tsc`; the worktree still has an unrelated untracked `.codex-supervisor/replay/` directory.

Addressed CodeRabbit thread `PRRT_kwDORgvdZ8518BXw` by replacing the sticky browser-only `lastCommandLabel` state with an expiring issue-scoped correlation token, extending the token with the refreshed selected issue, and only annotating SSE timeline rows whose event issue ids intersect that token. Added a regression that proves an unrelated later recovery event does not keep rendering as `after run-once`, committed it as `738b0fd` (`Tighten dashboard timeline event correlation`), and pushed `codex/issue-813`. `gh pr view 819 --json number,state,isDraft,url,mergeStateStatus,reviewDecision,headRefName,headRefOid,baseRefName` now shows PR #819 open on head `738b0fd2bdcea010c5f59d0ca822299c36636417` with merge state `UNSTABLE`.

Summary: Scoped operator timeline correlation to matching issue ids with an expiring browser token and added a regression for unrelated later events
State hint: addressing_review
Blocked reason: none
Tests: `npx tsx --test src/backend/webui-dashboard-browser-logic.test.ts src/backend/webui-dashboard.test.ts`; `npx tsx --test src/backend/supervisor-http-server.test.ts`; `npm run build`
Failure signature: PRRT_kwDORgvdZ8518BXw
Next action: monitor PR #819 for refreshed review-thread status and CI after commit `738b0fd` landed on `codex/issue-813`

## Active Failure Context
- Category: review
- Summary: 1 unresolved automated review thread(s) remain.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/819#discussion_r2970770041
- Details:
  - src/backend/webui-dashboard-browser-script.ts:48 _⚠️ Potential issue_ | _🟠 Major_ **Scope command/event correlation more tightly.** Line 606 stores `args.label` in shared state, and Lines 692-698 reuse it for every later SSE row until something else overwrites it. After one `run-once`, unrelated background events can keep rendering as `after run-once`, which makes the new timeline misleading instead of correlated. Please replace the sticky string with a bounded correlation token — e.g. affected issue number(s) plus an expiry window — and only attach it to matching events. Also applies to: 606-607, 692-698 <details> <summary>🤖 Prompt for AI Agents</summary> ``` Verify each finding against the current code and only fix it if needed. In `@src/backend/webui-dashboard-browser-script.ts` around lines 47 - 48, Replace the sticky shared string lastCommandLabel with a bounded correlation token: when the run-once handler (where args.label is set) creates the timeline context, generate and store a token object (e.g., {label: args.label, issues: <affectedIssueIds>, expiresAt: Date.now()+WINDOW_MS}) instead of a plain string in state; when processing incoming SSE rows (the SSE row handling / timelineEntries append code), only attach the label to an event if the event’s issue id(s) intersect the token.issues and Date.now() < token.expiresAt; otherwise leave the event unlabeled. Also ensure the token is cleared/expired after WINDOW_MS and that timelineEntries consumers check the token object (not the old lastCommandLabel string). ``` </details> <!-- fingerprinting:phantom:medusa:grasshopper --> <!-- This is an auto-generated comment by CodeRabbit -->

## Codex Working Notes
### Current Handoff
- Hypothesis: the remaining review thread was correct because the browser script kept one sticky command label in shared state and applied it to every later SSE row regardless of issue scope.
- What changed: replaced the sticky timeline label with an expiring `commandCorrelation` token keyed to command label plus relevant issue ids; seeded it from the pre-command selected issue and explicit command issue number, extended it after the refresh picks a new selected issue, and only rendered `after <command>` on SSE entries whose event issue ids intersect the token. Added a pure browser-logic regression for event issue-id extraction plus a dashboard regression that proves an unrelated later recovery event stays unlabeled.
- Current blocker: none
- Next exact step: monitor PR #819 (`https://github.com/TommyKammy/codex-supervisor/pull/819`) for thread resolution and merge-state changes after pushed commit `738b0fd`.
- Verification gap: none locally for the browser correlation path; the remaining uncertainty is whether GitHub review state and checks settle cleanly on the updated head.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/backend/supervisor-http-server.test.ts`, `src/backend/webui-dashboard-browser-logic.test.ts`, `src/backend/webui-dashboard-browser-logic.ts`, `src/backend/webui-dashboard-browser-script.ts`, `src/backend/webui-dashboard-page.ts`, `src/backend/webui-dashboard.test.ts`
- Rollback concern: keep the correlation logic thin and browser-only; do not turn the timeline into a backend persistence feature or widen the safe-command surface.
- Last focused command: `gh pr view 819 --json number,state,isDraft,url,mergeStateStatus,reviewDecision,headRefName,headRefOid,baseRefName`
- Last focused failure: `PRRT_kwDORgvdZ8518BXw`
- Last focused commands:
```bash
npx tsx --test src/backend/webui-dashboard-browser-logic.test.ts src/backend/webui-dashboard.test.ts
npx tsx --test src/backend/supervisor-http-server.test.ts
npm run build
```
### Scratchpad
- 2026-03-22T12:46:24+09:00: committed the review fix as `738b0fd` (`Tighten dashboard timeline event correlation`), pushed `codex/issue-813`, and confirmed via `gh pr view 819 --json number,state,isDraft,url,mergeStateStatus,reviewDecision,headRefName,headRefOid,baseRefName` that PR #819 is open on head `738b0fd2bdcea010c5f59d0ca822299c36636417` with merge state `UNSTABLE`.
- 2026-03-22T12:44:20+09:00: validated CodeRabbit thread `PRRT_kwDORgvdZ8518BXw`; the review comment was correct because SSE rows still reused a sticky `lastCommandLabel`. Replaced it with an expiring issue-scoped correlation token in the browser script, added a browser-logic helper for extracting event issue ids, and passed `npx tsx --test src/backend/webui-dashboard-browser-logic.test.ts src/backend/webui-dashboard.test.ts`, `npx tsx --test src/backend/supervisor-http-server.test.ts`, and `npm run build`.
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
