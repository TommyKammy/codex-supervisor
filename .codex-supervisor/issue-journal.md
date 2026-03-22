# Issue #824: WebUI issue details hygiene: stop defaulting typed shortcuts to historical tracked done issues

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/824
- Branch: codex/issue-824
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: resolving_conflict
- Attempt count: 7 (implementation=5, repair=2)
- Last head SHA: 3797ce28343ff708e86858aa5874d655910efe99
- Blocked reason: none
- Last failure signature: dirty:3797ce28343ff708e86858aa5874d655910efe99
- Repeated failure signature count: 1
- Updated at: 2026-03-22T10:56:27Z

## Latest Codex Summary
Default Issue Details shortcuts still exclude tracked `done` history by default. [webui-dashboard-browser-logic.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-824/src/backend/webui-dashboard-browser-logic.ts#L191) continues to reuse the tracked-history filter when building shortcuts, so active/runnable/blocked/non-`done` tracked issues stay prioritized while completed tracked items remain available through the tracked-history panel. The focused regressions in [webui-dashboard-browser-logic.test.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-824/src/backend/webui-dashboard-browser-logic.test.ts#L118) and [webui-dashboard.test.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-824/src/backend/webui-dashboard.test.ts#L528) stayed green after integrating `origin/main`.

`origin/main` merged cleanly into `codex/issue-824` apart from `.codex-supervisor/issue-journal.md`, which conflicted because `main` carried another issue worktree's journal content. Focused merge verification passed with `npx tsx --test src/backend/webui-dashboard.test.ts src/backend/webui-dashboard-browser-logic.test.ts src/backend/supervisor-http-server.test.ts src/supervisor/supervisor-service.test.ts src/getting-started-docs.test.ts src/doctor.test.ts` and `npm run build`. The next branch action is to push the merge-resolution commit to draft PR `#831`: https://github.com/TommyKammy/codex-supervisor/pull/831.

Summary: Integrated `origin/main`, preserved the shortcut-history hygiene fix, and reran focused dashboard/backend/docs verification
State hint: resolving_conflict
Blocked reason: none
Tests: `npx tsx --test src/backend/webui-dashboard.test.ts src/backend/webui-dashboard-browser-logic.test.ts src/backend/supervisor-http-server.test.ts src/supervisor/supervisor-service.test.ts src/getting-started-docs.test.ts src/doctor.test.ts` (passed); `npm run build` (passed)
Failure signature: none
Next action: commit the merge resolution, push `codex/issue-824`, and monitor PR #831 for refreshed CI

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: #824 only needed to keep filtering tracked `done` issues out of `collectIssueShortcuts()`; the base-branch conflict was limited to the per-worktree journal and did not require any behavioral change to the dashboard implementation.
- What changed: merged `origin/main` into `codex/issue-824`, kept the issue-824 journal instead of `main`'s unrelated issue-829 journal during conflict resolution, and reran the focused dashboard/browser/backend/docs verification set on the merged tree.
- Current blocker: none
- Next exact step: finalize the merge commit, push `codex/issue-824`, and watch PR `#831` for the new CI cycle.
- Verification gap: none in the scoped merge surface; the dashboard shortcut tests, merged HTTP/setup-readiness tests, docs test, doctor test, and `npm run build` all passed locally after the base integration.
- Files touched: `.codex-supervisor/issue-journal.md`
- Rollback concern: keep the tracked-history panel behavior and the setup-readiness HTTP/docs changes from `origin/main`; only the journal conflict should be branch-local.
- Last focused command: `npm run build`
- Last focused failure: `merge-conflict-issue-journal`
- Last focused commands:
```bash
git fetch origin
git merge --no-edit origin/main
git checkout --ours .codex-supervisor/issue-journal.md
npx tsx --test src/backend/webui-dashboard.test.ts src/backend/webui-dashboard-browser-logic.test.ts src/backend/supervisor-http-server.test.ts src/supervisor/supervisor-service.test.ts src/getting-started-docs.test.ts src/doctor.test.ts
npm run build
```
### Scratchpad
- 2026-03-22T10:56:27Z: `git merge --no-edit origin/main` reported a single content conflict in `.codex-supervisor/issue-journal.md`; all product code and tests from `origin/main` merged without manual intervention.
- 2026-03-22T10:56:27Z: resolved the journal conflict by restoring the issue-824 journal content and updating it for the current merge-resolution pass instead of taking `main`'s unrelated issue-829 journal.
- 2026-03-22T10:56:27Z: focused merge verification passed with `npx tsx --test src/backend/webui-dashboard.test.ts src/backend/webui-dashboard-browser-logic.test.ts src/backend/supervisor-http-server.test.ts src/supervisor/supervisor-service.test.ts src/getting-started-docs.test.ts src/doctor.test.ts` and `npm run build`.
- 2026-03-22T08:57:53Z: fixed the remaining shortcut-strip leak by switching tracked shortcut collection to `collectTrackedIssues(status)`, which keeps tracked `done` issues out of the default Issue Details shortcuts while leaving them available behind the tracked-history toggle.
- 2026-03-22T08:57:53Z: added focused regressions in `src/backend/webui-dashboard-browser-logic.test.ts` and `src/backend/webui-dashboard.test.ts`; `npx tsx --test src/backend/webui-dashboard.test.ts src/backend/webui-dashboard-browser-logic.test.ts` and `npm run build` both passed on the local diff.
- 2026-03-22T06:48:38+00:00: initial `npm run build` failed because `tsc` was missing in this worktree; restored dependencies with `npm ci`, reran the focused tests, and `npm run build` then passed.
