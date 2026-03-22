# Issue #838: WebUI setup checklist: render grouped first-run guidance from typed setup-readiness

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/838
- Branch: codex/issue-838
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: stabilizing
- Attempt count: 20 (implementation=20, repair=0)
- Last head SHA: 6c395a5000a91ba4ff2ec62c5d097a828e4e9165
- Blocked reason: none
- Last failure signature: stale-stabilizing-no-pr-recovery-loop
- Repeated failure signature count: 1
- Updated at: 2026-03-22T16:35:07.368Z

## Latest Codex Summary
`origin/main` already had the dedicated `/setup` shell, but the page was still flattening typed setup-readiness into terse pipe-delimited strings. I updated the setup shell to render a grouped first-run checklist instead: blockers now lead the page with remediation context, config fields and host checks render as readable checklist cards with current values and status, and provider/trust posture now expose typed detail sections instead of single summary lines. I also expanded the focused setup-shell test to pin the grouped rendering behavior and reran the issue’s WebUI verification after fixing a singular/plural blocker-summary copy bug.

Summary: Reworked the WebUI setup shell into a grouped, read-only first-run checklist driven by the typed setup-readiness DTO and added focused assertions for blockers, field readiness, host checks, provider posture, and trust posture.
State hint: implementing
Blocked reason: none
Tests: `npx tsx --test src/backend/webui-dashboard-browser-logic.test.ts src/backend/webui-dashboard.test.ts`
Failure signature: none
Next action: Commit this focused setup-shell checkpoint on `codex/issue-838`, then push the branch and open a draft PR if one still does not exist.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the setup shell landed on `main`, but it still fell short of issue #838 because the typed setup-readiness DTO was rendered as raw summary strings rather than grouped operator guidance.
- What changed: rechecked the required memory files and live git state, confirmed `codex/issue-838` initially matched `origin/main` at `6c395a5`, then inspected the merged setup shell and found it still rendering blockers, fields, and host checks as pipe-delimited text. I updated [src/backend/webui-setup-page.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-838/src/backend/webui-setup-page.ts) and [src/backend/webui-setup-browser-script.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-838/src/backend/webui-setup-browser-script.ts) to surface blockers first and render grouped checklist cards for blockers, config fields, host checks, provider posture, and trust posture. I also updated [src/backend/webui-dashboard.test.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-838/src/backend/webui-dashboard.test.ts) to assert the readable grouped output, then reran the focused WebUI verification. The first run exposed a singular blocker-summary grammar bug (`1 blocking condition need attention...`), which I fixed before the second run passed.
- Current blocker: none
- Next exact step: commit the grouped setup-shell changes and journal update on `codex/issue-838`, then push/open a draft PR if the branch still has no PR.
- Verification gap: `npm run build` was not rerun in this pass; the focused issue command passed after the setup-shell rendering changes.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/backend/webui-dashboard.test.ts`, `src/backend/webui-setup-browser-script.ts`, `src/backend/webui-setup-page.ts`
- Rollback concern: low; the change is isolated to the `/setup` WebUI shell and its focused test coverage.
- Last focused command: `npx tsx --test src/backend/webui-dashboard-browser-logic.test.ts src/backend/webui-dashboard.test.ts`
- Last focused failure: none; the focused WebUI verification command passed.
- Last focused commands:
```bash
sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-838/AGENTS.generated.md
sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-838/context-index.md
sed -n '1,360p' .codex-supervisor/issue-journal.md
git status --short --branch
git rev-parse HEAD origin/main
git branch -vv
git log --oneline --decorate -5
gh pr list --head codex/issue-838 --json number,url,state,isDraft,headRefName,baseRefName
sed -n '1,260p' src/backend/webui-setup-page.ts
sed -n '1,260p' src/backend/webui-setup-browser-script.ts
sed -n '1040,1205p' src/backend/webui-dashboard.test.ts
sed -n '1,380p' src/backend/webui-dashboard.test.ts
git diff --stat
npx tsx --test src/backend/webui-dashboard-browser-logic.test.ts src/backend/webui-dashboard.test.ts
date -u +"%Y-%m-%dT%H:%M:%SZ"
```
### Scratchpad
- 2026-03-22T16:40:22Z: confirmed the merged `/setup` shell still flattened typed readiness into terse strings, updated the setup page/browser script to render grouped checklist cards with blockers first, expanded the focused setup-shell test coverage, hit a singular blocker-summary copy failure on the first rerun (`1 blocking condition need attention before first-run setup is complete.`), fixed that copy bug, and reran `npx tsx --test src/backend/webui-dashboard-browser-logic.test.ts src/backend/webui-dashboard.test.ts` successfully.
- 2026-03-22T16:23:50Z: revalidated the required memory/journal inputs, confirmed `codex/issue-838` still equals `origin/main` at `6c395a5` (`Add dedicated WebUI setup shell (#843)`), confirmed there is still no PR for the branch, reran `npx tsx --test src/backend/webui-dashboard-browser-logic.test.ts src/backend/webui-dashboard.test.ts`, and refreshed the journal-only handoff.
- 2026-03-22T16:11:48Z: revalidated that `codex/issue-838` still equals `origin/main` at `6c395a5`, confirmed there is still no PR for the branch, reran `npx tsx --test src/backend/webui-dashboard-browser-logic.test.ts src/backend/webui-dashboard.test.ts`, and refreshed the journal-only handoff.
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
