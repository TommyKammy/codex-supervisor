# Issue #838: WebUI setup checklist: render grouped first-run guidance from typed setup-readiness

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/838
- Branch: codex/issue-838
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 22 (implementation=20, repair=2)
- Last head SHA: 53e6aabdca468d2ad3b51f1814c0c49c334bffa7
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ851-1Bv|PRRT_kwDORgvdZ851-1B1|PRRT_kwDORgvdZ851-1B2
- Repeated failure signature count: 1
- Updated at: 2026-03-22T16:58:00Z

## Latest Codex Summary
Addressed the three remaining PR #851 review threads in the setup-shell renderer. [src/backend/webui-setup-browser-script.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-838/src/backend/webui-setup-browser-script.ts) now counts only required fields in the readiness summary, pluralizes the single host-check case correctly, and falls back to `unknown` field metadata instead of throwing on older or partial setup-readiness payloads. [src/backend/webui-dashboard.test.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-838/src/backend/webui-dashboard.test.ts) now proves those behaviors with an added optional field lacking metadata.

Focused verification passed with `npx tsx --test src/backend/webui-dashboard-browser-logic.test.ts src/backend/webui-dashboard.test.ts`. I committed the review fix as `e7a0732` (`Fix setup shell review follow-ups`), refreshed the journal in `53e6aab`, pushed `codex/issue-838`, and resolved the three CodeRabbit review threads on PR #851. The only remaining workspace delta is the untracked `.codex-supervisor/replay/` snapshot.

Summary: Fixed the remaining setup-shell review comments, added focused degraded-payload coverage, pushed the branch update, and resolved the automated review threads.
State hint: waiting_ci
Blocked reason: none
Tests: `npx tsx --test src/backend/webui-dashboard-browser-logic.test.ts src/backend/webui-dashboard.test.ts`
Failure signature: none
Next action: Monitor PR #851 for refreshed checks or any follow-up review on the pushed setup-shell fixes.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the remaining PR feedback is limited to renderer wording and degraded-data resilience, not to the broader grouped setup checklist design.
- What changed: re-read the required memory files and the live setup-shell sources, confirmed all three CodeRabbit review comments were valid against [src/backend/webui-setup-browser-script.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-838/src/backend/webui-setup-browser-script.ts), then fixed them locally. The field summary now counts only required fields, host readiness uses singular wording for one check, and field metadata rendering now tolerates missing `metadata` by falling back to `unknown`. I extended [src/backend/webui-dashboard.test.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-838/src/backend/webui-dashboard.test.ts) with an optional field lacking metadata so the test proves both the required-field denominator and the non-throwing fallback path. Focused verification passed, the code fix was committed as `e7a0732` (`Fix setup shell review follow-ups`), the journal refresh was committed as `53e6aab`, the branch was pushed to `origin/codex/issue-838`, and the three CodeRabbit review threads were resolved on PR #851.
- Current blocker: none
- Next exact step: monitor PR #851 for refreshed CI and any follow-up review after the pushed setup-shell fixes.
- Verification gap: `npm run build` was not rerun in this pass; the focused issue command passed after the setup-shell rendering changes.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/backend/webui-dashboard.test.ts`, `src/backend/webui-setup-browser-script.ts`
- Rollback concern: low; the change is isolated to the `/setup` WebUI shell and its focused test coverage.
- Last focused command: `npx tsx --test src/backend/webui-dashboard-browser-logic.test.ts src/backend/webui-dashboard.test.ts`
- Last focused failure: none; the focused WebUI verification command passed.
- Last focused commands:
```bash
sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-838/AGENTS.generated.md
sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-838/context-index.md
sed -n '1,260p' .codex-supervisor/issue-journal.md
git status --short
sed -n '1,260p' src/backend/webui-setup-browser-script.ts
rg -n "required setup fields|Overall host readiness|Source:" src/backend/webui-dashboard.test.ts src/backend/webui-dashboard-browser-logic.test.ts
git diff -- .codex-supervisor/issue-journal.md
sed -n '1120,1205p' src/backend/webui-dashboard.test.ts
sed -n '1070,1188p' src/backend/webui-dashboard.test.ts
npx tsx --test src/backend/webui-dashboard-browser-logic.test.ts src/backend/webui-dashboard.test.ts
git diff -- src/backend/webui-setup-browser-script.ts src/backend/webui-dashboard.test.ts
git add src/backend/webui-setup-browser-script.ts src/backend/webui-dashboard.test.ts
git commit -m "Fix setup shell review follow-ups"
git add .codex-supervisor/issue-journal.md
git commit -m "Update issue 838 journal"
git push origin codex/issue-838
gh api graphql -f query='mutation($threadId: ID!) { resolveReviewThread(input: { threadId: $threadId }) { thread { isResolved } } }' -F threadId='PRRT_kwDORgvdZ851-1Bv'
gh api graphql -f query='mutation($threadId: ID!) { resolveReviewThread(input: { threadId: $threadId }) { thread { isResolved } } }' -F threadId='PRRT_kwDORgvdZ851-1B1'
gh api graphql -f query='mutation($threadId: ID!) { resolveReviewThread(input: { threadId: $threadId }) { thread { isResolved } } }' -F threadId='PRRT_kwDORgvdZ851-1B2'
date -u +"%Y-%m-%dT%H:%M:%SZ"
```
### Scratchpad
- 2026-03-22T16:58:00Z: committed the journal refresh as `53e6aab`, pushed `codex/issue-838` to `origin`, and resolved the three CodeRabbit review threads `PRRT_kwDORgvdZ851-1Bv`, `PRRT_kwDORgvdZ851-1B1`, and `PRRT_kwDORgvdZ851-1B2` after the fix landed on the PR branch.
- 2026-03-22T16:55:10Z: validated the three remaining PR #851 CodeRabbit findings against the live renderer, fixed all three in `src/backend/webui-setup-browser-script.ts`, extended `src/backend/webui-dashboard.test.ts` with an optional field missing metadata to prove the fallback path, reran `npx tsx --test src/backend/webui-dashboard-browser-logic.test.ts src/backend/webui-dashboard.test.ts`, and committed the code fix as `e7a0732` (`Fix setup shell review follow-ups`).
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
