# Issue #839: Setup scaffold preview: generate a non-destructive config preview for guided setup

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/839
- Branch: codex/issue-839
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 089a267b8fb88b3e369fb55bc1eda1fa91e06d71
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-22T17:20:03.679Z

## Latest Codex Summary
- Added a read-only setup config preview path for first-run UX. The backend now derives a typed preview document from the shipped scaffold defaults, the current config JSON, and an optional server-selected review-provider profile without mutating the on-disk config. Unknown top-level config fields are preserved in the preview document and surfaced explicitly so the preview model does not silently discard them.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: a setup-oriented config preview can stay read-only if the backend treats it as a validated merged document preview, not as a browser-authored patch. The narrowest missing behavior was a dedicated preview builder plus a dedicated HTTP endpoint.
- What changed: added a focused config-layer regression proving `buildSetupConfigPreview()` preserves unknown existing fields and does not rewrite `supervisor.config.json`, then added an HTTP regression proving `/api/setup-config-preview?reviewProviderProfile=codex` returns a typed preview payload. Implemented [src/setup-config-preview.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-839/src/setup-config-preview.ts) to merge the shipped scaffold defaults, the current raw config document, and optional supported review-provider profile overrides into a read-only validated preview. Refactored [src/core/config.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-839/src/core/config.ts) so config validation can run directly against an in-memory document, then wired the new preview through [src/supervisor/supervisor.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-839/src/supervisor/supervisor.ts), [src/supervisor/supervisor-service.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-839/src/supervisor/supervisor-service.ts), and [src/backend/supervisor-http-server.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-839/src/backend/supervisor-http-server.ts).
- Current blocker: none
- Next exact step: review the final diff, commit the preview endpoint and scaffold changes, then open or update the draft PR for issue #839.
- Verification gap: none for the touched paths; the focused issue command and `npm run build` both passed after restoring dependencies with `npm ci`.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/backend/supervisor-http-server.test.ts`, `src/backend/supervisor-http-server.ts`, `src/config.test.ts`, `src/core/config.ts`, `src/setup-config-preview.ts`, `src/supervisor/supervisor-service.ts`, `src/supervisor/supervisor.ts`
- Rollback concern: low; the change is additive and read-only, centered on setup preview derivation and one new HTTP route.
- Last focused command: `npx tsx --test src/backend/supervisor-http-server.test.ts src/config.test.ts`
- Last focused failure: `Cannot find module './setup-config-preview'` in `src/config.test.ts` and `404 !== 200` for `/api/setup-config-preview`; both failures were resolved in this pass.
- Last focused commands:
```bash
sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-839/AGENTS.generated.md
sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-839/context-index.md
sed -n '1,260p' .codex-supervisor/issue-journal.md
git status --short
rg -n "setup|scaffold|preview|patch preview|guided setup|config preview" src
sed -n '1,260p' src/setup-readiness.ts
sed -n '1,220p' src/backend/supervisor-http-server.ts
sed -n '1,260p' src/config.test.ts
sed -n '1,260p' src/backend/supervisor-http-server.test.ts
sed -n '1,260p' docs/getting-started.md
sed -n '1,220p' src/supervisor/supervisor-service.ts
sed -n '1040,1115p' src/supervisor/supervisor.ts
sed -n '1,220p' supervisor.config.example.json
sed -n '1,220p' supervisor.config.codex.json
sed -n '1,220p' supervisor.config.copilot.json
sed -n '1,220p' supervisor.config.coderabbit.json
npx tsx --test src/backend/supervisor-http-server.test.ts src/config.test.ts
npm ci
npm run build
npx tsx --test src/backend/supervisor-http-server.test.ts src/config.test.ts
git diff -- src/core/config.ts src/setup-config-preview.ts src/backend/supervisor-http-server.ts src/backend/supervisor-http-server.test.ts src/config.test.ts src/supervisor/supervisor-service.ts src/supervisor/supervisor.ts
```
### Scratchpad
- 2026-03-22T11:28:50Z: implemented `metadata` on setup fields plus typed `remediation` on blockers in `src/setup-readiness.ts`, then updated service/HTTP/docs fixtures to pin the richer contract.
- 2026-03-22T10:58:09Z: committed merge `aa11199` (`Merge remote-tracking branch 'origin/main' into codex/issue-824`) and pushed it to `origin/codex/issue-824`.
- 2026-03-22T10:58:09Z: `gh pr view 831 --json mergeStateStatus,headRefOid,isDraft,url` reported head `aa11199ec6471b6c8f6d95b64745a12a565f5cc2`, draft `true`, and `mergeStateStatus` `UNSTABLE`, confirming the PR is no longer dirty and is waiting on refreshed checks.
- 2026-03-22T10:56:27Z: `git merge --no-edit origin/main` reported a single content conflict in `.codex-supervisor/issue-journal.md`; all product code and tests from `origin/main` merged without manual intervention.
- 2026-03-22T10:56:27Z: resolved the journal conflict by restoring the issue-824 journal content and updating it for the current merge-resolution pass instead of taking `main`'s unrelated issue-829 journal.
- 2026-03-22T10:56:27Z: focused merge verification passed with `npx tsx --test src/backend/webui-dashboard.test.ts src/backend/webui-dashboard-browser-logic.test.ts src/backend/supervisor-http-server.test.ts src/supervisor/supervisor-service.test.ts src/getting-started-docs.test.ts src/doctor.test.ts` and `npm run build`.
- 2026-03-22T08:57:53Z: fixed the remaining shortcut-strip leak by switching tracked shortcut collection to `collectTrackedIssues(status)`, which keeps tracked `done` issues out of the default Issue Details shortcuts while leaving them available behind the tracked-history toggle.
- 2026-03-22T08:57:53Z: added focused regressions in `src/backend/webui-dashboard-browser-logic.test.ts` and `src/backend/webui-dashboard.test.ts`; `npx tsx --test src/backend/webui-dashboard.test.ts src/backend/webui-dashboard-browser-logic.test.ts` and `npm run build` both passed on the local diff.
- 2026-03-22T06:48:38+00:00: initial `npm run build` failed because `tsc` was missing in this worktree; restored dependencies with `npm ci`, reran the focused tests, and `npm run build` then passed.
