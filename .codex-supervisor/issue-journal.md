# Issue #824: WebUI issue details hygiene: stop defaulting typed shortcuts to historical tracked done issues

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/824
- Branch: codex/issue-824
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: waiting_ci
- Attempt count: 7 (implementation=5, repair=2)
- Last head SHA: aa11199ec6471b6c8f6d95b64745a12a565f5cc2
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-22T10:58:09Z

## Latest Codex Summary
Default Issue Details shortcuts still exclude tracked `done` history by default. [webui-dashboard-browser-logic.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-824/src/backend/webui-dashboard-browser-logic.ts#L191) continues to reuse the tracked-history filter when building shortcuts, so active/runnable/blocked/non-`done` tracked issues stay prioritized while completed tracked items remain available through the tracked-history panel. The focused regressions in [webui-dashboard-browser-logic.test.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-824/src/backend/webui-dashboard-browser-logic.test.ts#L118) and [webui-dashboard.test.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-824/src/backend/webui-dashboard.test.ts#L528) stayed green after integrating `origin/main`.

`origin/main` merged cleanly into `codex/issue-824` apart from `.codex-supervisor/issue-journal.md`, which conflicted because `main` carried another issue worktree's journal content. Focused merge verification passed with `npx tsx --test src/backend/webui-dashboard.test.ts src/backend/webui-dashboard-browser-logic.test.ts src/backend/supervisor-http-server.test.ts src/supervisor/supervisor-service.test.ts src/getting-started-docs.test.ts src/doctor.test.ts` and `npm run build`, then the merge commit `aa11199` was pushed to draft PR `#831`: https://github.com/TommyKammy/codex-supervisor/pull/831. `gh pr view 831 --json mergeStateStatus,headRefOid,isDraft,url` now reports head `aa11199ec6471b6c8f6d95b64745a12a565f5cc2` with `mergeStateStatus` `UNSTABLE`, so the dirty merge conflict is cleared and fresh CI is pending.

Summary: Integrated `origin/main`, resolved the journal-only merge conflict, and pushed `aa11199` to PR #831
State hint: waiting_ci
Blocked reason: none
Tests: `npx tsx --test src/backend/webui-dashboard.test.ts src/backend/webui-dashboard-browser-logic.test.ts src/backend/supervisor-http-server.test.ts src/supervisor/supervisor-service.test.ts src/getting-started-docs.test.ts src/doctor.test.ts` (passed); `npm run build` (passed)
Failure signature: none
Next action: monitor PR #831 for refreshed CI on `aa11199` and address any follow-up if the new run fails

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: #824 only needed to keep filtering tracked `done` issues out of `collectIssueShortcuts()`; the base-branch conflict was limited to the per-worktree journal and did not require any behavioral change to the dashboard implementation.
- What changed: merged `origin/main` into `codex/issue-824`, kept the issue-824 journal instead of `main`'s unrelated issue-829 journal during conflict resolution, reran the focused dashboard/browser/backend/docs verification set on the merged tree, and pushed merge commit `aa11199` to `origin/codex/issue-824`.
- Current blocker: none
- Next exact step: watch PR `#831` for the new CI cycle on `aa11199` and address any failing check or review follow-up.
- Verification gap: none in the scoped merge surface; the dashboard shortcut tests, merged HTTP/setup-readiness tests, docs test, doctor test, and `npm run build` all passed locally after the base integration.
- Files touched: `.codex-supervisor/issue-journal.md`
- Rollback concern: keep the tracked-history panel behavior and the setup-readiness HTTP/docs changes from `origin/main`; only the journal conflict should be branch-local.
- Last focused command: `gh pr view 831 --json mergeStateStatus,headRefOid,isDraft,url`
- Last focused failure: none
- Last focused commands:
```bash
git fetch origin
git merge --no-edit origin/main
git checkout --ours .codex-supervisor/issue-journal.md
npx tsx --test src/backend/webui-dashboard.test.ts src/backend/webui-dashboard-browser-logic.test.ts src/backend/supervisor-http-server.test.ts src/supervisor/supervisor-service.test.ts src/getting-started-docs.test.ts src/doctor.test.ts
npm run build
git commit --no-edit
git push origin codex/issue-824
gh pr view 831 --json mergeStateStatus,headRefOid,isDraft,url
```
### Scratchpad
- 2026-03-22T10:58:09Z: committed merge `aa11199` (`Merge remote-tracking branch 'origin/main' into codex/issue-824`) and pushed it to `origin/codex/issue-824`.
- 2026-03-22T10:58:09Z: `gh pr view 831 --json mergeStateStatus,headRefOid,isDraft,url` reported head `aa11199ec6471b6c8f6d95b64745a12a565f5cc2`, draft `true`, and `mergeStateStatus` `UNSTABLE`, confirming the PR is no longer dirty and is waiting on refreshed checks.
- 2026-03-22T10:56:27Z: `git merge --no-edit origin/main` reported a single content conflict in `.codex-supervisor/issue-journal.md`; all product code and tests from `origin/main` merged without manual intervention.
- 2026-03-22T10:56:27Z: resolved the journal conflict by restoring the issue-824 journal content and updating it for the current merge-resolution pass instead of taking `main`'s unrelated issue-829 journal.
- 2026-03-22T10:56:27Z: focused merge verification passed with `npx tsx --test src/backend/webui-dashboard.test.ts src/backend/webui-dashboard-browser-logic.test.ts src/backend/supervisor-http-server.test.ts src/supervisor/supervisor-service.test.ts src/getting-started-docs.test.ts src/doctor.test.ts` and `npm run build`.
- 2026-03-22T08:57:53Z: fixed the remaining shortcut-strip leak by switching tracked shortcut collection to `collectTrackedIssues(status)`, which keeps tracked `done` issues out of the default Issue Details shortcuts while leaving them available behind the tracked-history toggle.
- 2026-03-22T08:57:53Z: added focused regressions in `src/backend/webui-dashboard-browser-logic.test.ts` and `src/backend/webui-dashboard.test.ts`; `npx tsx --test src/backend/webui-dashboard.test.ts src/backend/webui-dashboard-browser-logic.test.ts` and `npm run build` both passed on the local diff.
- 2026-03-22T06:48:38+00:00: initial `npm run build` failed because `tsc` was missing in this worktree; restored dependencies with `npm ci`, reran the focused tests, and `npm run build` then passed.
