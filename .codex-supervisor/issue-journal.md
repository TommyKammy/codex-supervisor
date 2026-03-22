# Issue #836: Setup UX contract follow-up: add typed remediation and field metadata for guided setup

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/836
- Branch: codex/issue-836
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: a71b05df36a102c26038da0e2287a8867f5a6ed6
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-22T11:26:46.045Z

## Latest Codex Summary
- Added typed setup-readiness field metadata and blocker remediation guidance for the guided setup contract, updated the focused docs snippet, and verified the generator/service/HTTP surfaces with focused tests.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the current setup-readiness contract already separated first-run setup from `doctor`, but it still lacked typed field metadata and blocker remediation guidance, forcing a future setup UI to infer editability and next actions from labels and free-form messages.
- What changed: added a focused reproducer in `src/doctor.test.ts`, extended `src/setup-readiness.ts` with typed field metadata and typed blocker remediation, and updated the service/HTTP/docs fixtures so the richer contract is pinned end-to-end.
- Current blocker: none
- Next exact step: watch draft PR `#842` for CI and address any contract or review follow-up if the broader suite surfaces compatibility issues.
- Verification gap: `npm run build` has not been rerun on this diff; the scoped setup-readiness generator/service/HTTP/docs tests passed locally.
- Files touched: `.codex-supervisor/issue-journal.md`, `docs/getting-started.md`, `src/backend/supervisor-http-server.test.ts`, `src/doctor.test.ts`, `src/getting-started-docs.test.ts`, `src/setup-readiness.ts`, `src/supervisor/supervisor-service.test.ts`
- Rollback concern: the new field `metadata` and blocker `remediation` properties are part of the HTTP contract now, so any rollback has to revert the generator and fixture/docs updates together.
- Last focused command: `gh pr create --draft --base main --head codex/issue-836 --title "Setup UX contract follow-up: add typed remediation and field metadata for guided setup" ...`
- Last focused failure: `TypeError: Cannot read properties of undefined (reading 'source')` from `src/doctor.test.ts` before the new field metadata was implemented.
- Last focused commands:
```bash
npx tsx --test src/doctor.test.ts
npx tsx --test src/doctor.test.ts src/supervisor/supervisor-service.test.ts src/backend/supervisor-http-server.test.ts src/getting-started-docs.test.ts
npx tsx --test src/doctor.test.ts src/supervisor/supervisor-service.test.ts src/backend/supervisor-http-server.test.ts
git push origin codex/issue-836
gh pr create --draft --base main --head codex/issue-836 --title "Setup UX contract follow-up: add typed remediation and field metadata for guided setup" ...
```
### Scratchpad
- 2026-03-22T11:31:39Z: pushed `codex/issue-836` to `origin` and opened draft PR `#842` at `https://github.com/TommyKammy/codex-supervisor/pull/842`.
- 2026-03-22T11:30:47Z: committed `b1bcbba` (`Add typed setup readiness remediation metadata`) with the setup-readiness contract, fixture, docs, and journal updates.
- 2026-03-22T11:30:09Z: focused setup-readiness verification passed with `npx tsx --test src/doctor.test.ts src/supervisor/supervisor-service.test.ts src/backend/supervisor-http-server.test.ts`; the broader scoped run including `src/getting-started-docs.test.ts` also passed.
- 2026-03-22T11:28:15Z: added the narrow reproducer in `src/doctor.test.ts`; the first focused run failed with `TypeError: Cannot read properties of undefined (reading 'source')`, confirming the DTO lacked typed field metadata.
- 2026-03-22T11:28:50Z: implemented `metadata` on setup fields plus typed `remediation` on blockers in `src/setup-readiness.ts`, then updated service/HTTP/docs fixtures to pin the richer contract.
- 2026-03-22T10:58:09Z: committed merge `aa11199` (`Merge remote-tracking branch 'origin/main' into codex/issue-824`) and pushed it to `origin/codex/issue-824`.
- 2026-03-22T10:58:09Z: `gh pr view 831 --json mergeStateStatus,headRefOid,isDraft,url` reported head `aa11199ec6471b6c8f6d95b64745a12a565f5cc2`, draft `true`, and `mergeStateStatus` `UNSTABLE`, confirming the PR is no longer dirty and is waiting on refreshed checks.
- 2026-03-22T10:56:27Z: `git merge --no-edit origin/main` reported a single content conflict in `.codex-supervisor/issue-journal.md`; all product code and tests from `origin/main` merged without manual intervention.
- 2026-03-22T10:56:27Z: resolved the journal conflict by restoring the issue-824 journal content and updating it for the current merge-resolution pass instead of taking `main`'s unrelated issue-829 journal.
- 2026-03-22T10:56:27Z: focused merge verification passed with `npx tsx --test src/backend/webui-dashboard.test.ts src/backend/webui-dashboard-browser-logic.test.ts src/backend/supervisor-http-server.test.ts src/supervisor/supervisor-service.test.ts src/getting-started-docs.test.ts src/doctor.test.ts` and `npm run build`.
- 2026-03-22T08:57:53Z: fixed the remaining shortcut-strip leak by switching tracked shortcut collection to `collectTrackedIssues(status)`, which keeps tracked `done` issues out of the default Issue Details shortcuts while leaving them available behind the tracked-history toggle.
- 2026-03-22T08:57:53Z: added focused regressions in `src/backend/webui-dashboard-browser-logic.test.ts` and `src/backend/webui-dashboard.test.ts`; `npx tsx --test src/backend/webui-dashboard.test.ts src/backend/webui-dashboard-browser-logic.test.ts` and `npm run build` both passed on the local diff.
- 2026-03-22T06:48:38+00:00: initial `npm run build` failed because `tsc` was missing in this worktree; restored dependencies with `npm ci`, reran the focused tests, and `npm run build` then passed.
