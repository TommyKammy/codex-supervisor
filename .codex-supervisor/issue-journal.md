# Issue #824: WebUI issue details hygiene: stop defaulting typed shortcuts to historical tracked done issues

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/824
- Branch: codex/issue-824
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: stabilizing
- Attempt count: 5 (implementation=5, repair=0)
- Last head SHA: 580d6b37dfe8b10c4f349d7a99ea864e389c2ea4
- Blocked reason: none
- Last failure signature: stale-stabilizing-no-pr-recovery-loop
- Repeated failure signature count: 1
- Updated at: 2026-03-22T08:55:48.068Z

## Latest Codex Summary
There was still one browser-side hygiene gap after the tracked-history panel changes landed on `main`: [webui-dashboard-browser-logic.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-824/src/backend/webui-dashboard-browser-logic.ts) was still feeding tracked `done` issues into the default typed shortcut strip. I fixed that by reusing the existing non-`done` tracked filter for shortcut collection and added regressions in [webui-dashboard-browser-logic.test.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-824/src/backend/webui-dashboard-browser-logic.test.ts) and [webui-dashboard.test.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-824/src/backend/webui-dashboard.test.ts).

Focused verification passed with `npx tsx --test src/backend/webui-dashboard.test.ts src/backend/webui-dashboard-browser-logic.test.ts` and `npm run build`. `gh pr list --head codex/issue-824` is still empty, so this branch now has a real local checkpoint that should be committed, pushed, and opened as a draft PR.

Summary: Filtered tracked `done` issues out of the default Issue Details shortcut strip and added focused browser-logic/dashboard regressions.
State hint: stabilizing
Blocked reason: none
Tests: `npx tsx --test src/backend/webui-dashboard.test.ts src/backend/webui-dashboard-browser-logic.test.ts` (passed); `npm run build` (passed)
Failure signature: none
Next action: commit the focused dashboard shortcut fix, push `codex/issue-824`, and open a draft PR

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: #824 still had a narrow browser-side shortcut leak even after the tracked-history panel work merged; filtering tracked `done` issues out of `collectIssueShortcuts()` closes the remaining default-noise gap without changing backend selection semantics.
- What changed: updated the Issue Details shortcut collector to reuse the existing non-`done` tracked filter, added a browser-logic regression that includes a tracked `done` issue but expects it to stay out of the shortcut list, and added a dashboard harness regression proving the rendered shortcut strip still shows only the current runnable/blocked issues when tracked history contains a completed item.
- Current blocker: none
- Next exact step: commit this focused browser/dashboard change, push `codex/issue-824`, and open a draft PR so review can happen against the actual shortcut-strip fix.
- Verification gap: none for the scoped shortcut-history hygiene behavior; focused dashboard/browser-logic tests and `npm run build` passed on the local source diff.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/backend/webui-dashboard-browser-logic.ts`, `src/backend/webui-dashboard-browser-logic.test.ts`, `src/backend/webui-dashboard.test.ts`
- Rollback concern: keep the tracked-history panel behavior and only remove tracked `done` issues from the default shortcut strip; broader history should remain available through the dedicated tracked-history section and its reveal toggle.
- Last focused command: `npm run build`
- Last focused failure: none
- Last focused commands:
```bash
git diff --stat -- src/backend/webui-dashboard-browser-logic.ts src/backend/webui-dashboard-browser-logic.test.ts src/backend/webui-dashboard.test.ts
npx tsx --test src/backend/webui-dashboard.test.ts src/backend/webui-dashboard-browser-logic.test.ts
npm run build
gh pr list --state all --head codex/issue-824 --json number,title,state,isDraft,headRefName,baseRefName,url
git status --short
```
### Scratchpad
- 2026-03-22T08:57:53Z: fixed the remaining shortcut-strip leak by switching tracked shortcut collection to `collectTrackedIssues(status)`, which keeps tracked `done` issues out of the default Issue Details shortcuts while leaving them available behind the tracked-history toggle.
- 2026-03-22T08:57:53Z: added focused regressions in `src/backend/webui-dashboard-browser-logic.test.ts` and `src/backend/webui-dashboard.test.ts`; `npx tsx --test src/backend/webui-dashboard.test.ts src/backend/webui-dashboard-browser-logic.test.ts` and `npm run build` both passed on the local diff.
- 2026-03-22T08:57:53Z: confirmed `gh pr list --head codex/issue-824` is still empty, so the next branch action is a fresh checkpoint commit plus draft PR creation rather than supervisor-state reconciliation.
- 2026-03-22T08:05:32Z: confirmed `gh pr view 830` reports `MERGED` at `2026-03-22T07:42:57Z` from head branch `codex/issue-823` into `main`.
- 2026-03-22T08:05:32Z: confirmed `gh pr list --head codex/issue-824` returns no PRs, and `git diff --stat origin/main...HEAD` is empty because `codex/issue-824` currently points at `origin/main` (`580d6b3`).
- 2026-03-22T06:48:38+00:00: focused verification passed with `npx tsx --test src/backend/webui-dashboard.test.ts src/backend/webui-dashboard-browser-logic.test.ts`.
- 2026-03-22T06:48:38+00:00: initial `npm run build` failed because `tsc` was missing in this worktree; restored dependencies with `npm ci`, reran the focused tests, and `npm run build` then passed.
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
