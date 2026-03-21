# Issue #802: WebUI operator UX: improve safe-command feedback and refresh behavior

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/802
- Branch: codex/issue-802
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 3 (implementation=2, repair=1)
- Last head SHA: a64185a85af840f5d5e2fbdca0c9e209ecef97f3
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ8517YKs
- Repeated failure signature count: 1
- Updated at: 2026-03-21T23:54:52.187Z

## Latest Codex Summary
Draft PR [#807](https://github.com/TommyKammy/codex-supervisor/pull/807) is open from `codex/issue-802`. I reran the focused verification on the current checkpoint, then pushed the branch and committed the journal handoff updates so the PR tip reflects the current state.

Worktree is clean except for the pre-existing untracked [`.codex-supervisor/replay/`](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-802/.codex-supervisor/replay/) directory. Focused verification passed with `npx tsx --test src/backend/webui-dashboard.test.ts src/backend/supervisor-http-server.test.ts` and `npm run build`.

Summary: Verified the #802 checkpoint locally, pushed `codex/issue-802`, opened draft PR #807, and updated the issue journal with the current PR state
State hint: draft_pr
Blocked reason: none
Tests: `npx tsx --test src/backend/webui-dashboard.test.ts src/backend/supervisor-http-server.test.ts`; `npm run build`
Failure signature: none
Next action: monitor draft PR #807 and address any CI or review feedback

## Active Failure Context
- Category: review
- Summary: 1 unresolved automated review thread(s) remain.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/807#discussion_r2970553908
- Details:
  - src/backend/webui-dashboard.ts:1011 _⚠️ Potential issue_ | _🟡 Minor_ **Missing `status` parameter for consistent feedback.** The `rejectCommand` call here passes only 2 arguments while the function expects 3. Due to the fallback in `renderCommandResult()`, the full summary text will be displayed as the status, which is verbose compared to the concise "cancelled" status used in other rejection paths. <details> <summary>🔧 Proposed fix for consistency</summary> ```diff if (state.explain === null) { - rejectCommand("requeue", "Load an issue successfully before requeueing."); + rejectCommand("requeue", "Load an issue successfully before requeueing.", "requeue cancelled"); return; } ``` </details> <details> <summary>🤖 Prompt for AI Agents</summary> ``` Verify each finding against the current code and only fix it if needed. In `@src/backend/webui-dashboard.ts` around lines 1007 - 1011, The rejectCommand call inside the elements.requeueButton click handler is missing the required third status argument; update the call in the event listener (where it checks if state.explain === null) to pass a concise status (e.g., "cancelled") as the third parameter so rejectCommand and renderCommandResult produce the same short status text as other rejection paths; locate the handler attached to elements.requeueButton and add the status argument to the rejectCommand invocation. ``` </details> <!-- fingerprinting:phantom:medusa:ocelot --> <!-- This is an auto-generated comment by CodeRabbit -->

## Codex Working Notes
### Current Handoff
- Hypothesis: the only remaining #802 review gap is a browser-side requeue precondition rejection that still falls back to a verbose summary string instead of the concise cancelled status used by the other safe-command rejection paths.
- What changed: added the missing explicit `requeue cancelled` status for the dashboard's no-loaded-issue rejection path and covered it with a focused harness regression.
- Current blocker: none
- Next exact step: push the review-fix checkpoint to `codex/issue-802`, then monitor PR #807 for refreshed CI and review state.
- Verification gap: none locally after restoring dependencies with `npm ci`; remote CI has not run on this checkpoint yet.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/backend/webui-dashboard.test.ts`, `src/backend/webui-dashboard.ts`
- Rollback concern: keep supervisor-selected issue state separate from manually loaded issue details so refreshes follow backend selection without breaking explicit issue inspection or widening the command surface.
- Last focused command: `npm run build`
- Last focused failure: `PRRT_kwDORgvdZ8517YKs`; the requeue button's browser-side rejection path omitted the explicit status text and rendered the full summary as the visible command status.
- Last focused commands:
```bash
npx tsx --test src/backend/webui-dashboard.test.ts src/backend/supervisor-http-server.test.ts
npm run build
```
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
- Local dirt besides this work remains the pre-existing untracked `.codex-supervisor/replay/` directory.
- 2026-03-21T23:56:04Z: validated CodeRabbit thread `PRRT_kwDORgvdZ8517YKs`; the review comment was correct because the requeue click handler still called `rejectCommand()` without the explicit status argument.
- 2026-03-21T23:56:04Z: fixed the requeue no-loaded-issue rejection path to emit `requeue cancelled` and added a focused dashboard harness regression asserting the concise status plus zero POST attempts.
- 2026-03-21T23:56:04Z: focused verification passed with `npx tsx --test src/backend/webui-dashboard.test.ts src/backend/supervisor-http-server.test.ts` and `npm run build`.
- 2026-03-22T00:00:00Z: reproduced stale post-command refresh handling with a new dashboard harness case where bootstrap loaded issue #42, `run-once` refreshed status to selected issue #77, and the UI incorrectly kept `#42` selected until state was split into supervisor-selected vs loaded issue numbers.
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
