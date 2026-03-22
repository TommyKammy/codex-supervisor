# Issue #837: WebUI setup shell: add a dedicated first-run setup route backed by setup-readiness

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/837
- Branch: codex/issue-837
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: implementing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 9754a8ab7ba7bee04d83267639c51420bff6427e
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-22T12:58:00Z

## Latest Codex Summary
- Added a dedicated first-run setup shell backed by `/api/setup-readiness`, routed `/` to that shell only when setup is incomplete, and kept the steady-state operator dashboard available at `/dashboard` and at `/` once setup is configured. Focused HTTP/UI tests now cover the new setup-shell routing and typed setup rendering.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the WebUI gap was that `/` always rendered the operator dashboard even when typed setup readiness reported blockers, so first-run guidance needed its own shell and root-level route selection.
- What changed: added `src/backend/webui-setup.ts`, `src/backend/webui-setup-page.ts`, and `src/backend/webui-setup-browser-script.ts` for a dedicated setup shell that renders typed setup blockers, fields, host checks, provider posture, and trust posture from `/api/setup-readiness`; updated `src/backend/supervisor-http-server.ts` so `/setup` always serves that shell, `/dashboard` always serves the steady-state dashboard, and `/` now chooses between them based on `querySetupReadiness().ready`; tightened `src/backend/supervisor-http-server.test.ts` and `src/backend/webui-dashboard.test.ts` to pin the route split and setup-shell fetch/render behavior.
- Current blocker: none
- Next exact step: review the local diff, commit the setup-shell change on `codex/issue-837`, and open/update a draft PR if one is still absent.
- Verification gap: browser smoke coverage for the new setup shell was not added in this pass; focused unit/HTTP coverage plus `npm run build` passed locally.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/backend/supervisor-http-server.ts`, `src/backend/supervisor-http-server.test.ts`, `src/backend/webui-dashboard.test.ts`, `src/backend/webui-setup.ts`, `src/backend/webui-setup-page.ts`, `src/backend/webui-setup-browser-script.ts`
- Rollback concern: reverting only the server routing change would strand the new `/setup` shell and tests; reverting only the new setup shell files would break `/setup` and the root first-run flow.
- Last focused command: `npm run build`
- Last focused failure: `sh: 1: tsc: not found` during the first build attempt before restoring dependencies with `npm ci`; a later build also caught a TypeScript narrowing error in the new server test (`TS18047`/`TS2339` on `address.port`), which was fixed by capturing `port` after the listen-address guard.
- Last focused commands:
```bash
sed -n '1,260p' .codex-supervisor/issue-journal.md
npx tsx --test src/backend/supervisor-http-server.test.ts src/backend/webui-dashboard.test.ts
npm ci
npm run build
```
### Scratchpad
- 2026-03-22T12:57:00Z: reran `npx tsx --test src/backend/supervisor-http-server.test.ts src/backend/webui-dashboard.test.ts` and `npm run build`; both passed after fixing the server-test `address.port` narrowing issue.
- 2026-03-22T12:55:00Z: `npm run build` initially failed with `sh: 1: tsc: not found`; restored local dependencies with `npm ci` and reran build.
- 2026-03-22T12:48:00Z: added the narrow reproducer in `src/backend/supervisor-http-server.test.ts` and `src/backend/webui-dashboard.test.ts`; the first focused run failed because the legacy root-shell test still assumed `/` always served the operator dashboard after the new route selection landed.
- 2026-03-22T12:44:00Z: implemented the dedicated setup shell and route split so `/setup` serves first-run guidance, `/dashboard` serves the steady-state dashboard, and `/` chooses based on typed setup readiness.
- 2026-03-22T11:58:23Z: committed `aa95a0f` (`Sync setup readiness docs unions`), pushed `codex/issue-836`, and confirmed PR `#842` is on head `aa95a0f896e49ac26ed6cc9219b472238cbfa0a7` with `mergeStateStatus` `UNSTABLE` while refreshed checks start.
- 2026-03-22T11:57:07Z: updated the getting-started setup contract excerpt to match the implementation unions and added focused docs assertions for the missing value-type/remediation/key members.
- 2026-03-22T11:56:31Z: the first `npx tsx --test src/getting-started-docs.test.ts` run failed on an over-broad regex that tried to match the type alias definition and the later field usage in one expression; split those assertions and reran cleanly.
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
