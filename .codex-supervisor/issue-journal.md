# Issue #873: Operator observability contract: add typed retry, recovery, and phase-change context

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/873
- Branch: codex/issue-873
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: waiting_ci
- Attempt count: 3 (implementation=1, repair=2)
- Last head SHA: f5f7a2b40a69b46b8e4ce45116749e84dd7856cc
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ852EV-a
- Repeated failure signature count: 1
- Updated at: 2026-03-23T08:56:21Z

## Latest Codex Summary
Patched the journal renderer in [journal.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-873/src/core/journal.ts) so the rendered `Latest Codex Summary` always uses the live snapshot failure signature instead of preserving a stale footer from the prior Codex turn. Added a focused regression in [journal.test.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-873/src/journal.test.ts), pushed commit `f5f7a2b` to PR `#880`, resolved the CodeRabbit review thread, and triggered fresh build jobs.

Summary: Fixed the journal failure-signature rendering drift, added focused regression coverage, pushed commit `f5f7a2b`, resolved the review thread, and kicked off fresh PR builds
State hint: waiting_ci
Blocked reason: none
Tests: `npx tsx --test src/journal.test.ts`
Failure signature: PRRT_kwDORgvdZ852EV-a
Next action: Monitor PR `#880` checks for commit `f5f7a2b` and only re-enter repair if `build (ubuntu-latest)` or `build (macos-latest)` fails

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the journal writer preserves a stale `Failure signature:` footer from `last_codex_summary` even after supervisor state transitions update `last_failure_signature`, so the rendered snapshot needs to canonicalize that footer to the live signature.
- What changed: updated `src/core/journal.ts` to rewrite the rendered `Latest Codex Summary` failure-signature line from `record.last_failure_signature`, added focused regression coverage in `src/journal.test.ts`, pushed commit `f5f7a2b`, resolved the CodeRabbit review thread, and refreshed this journal to the new waiting-CI state.
- Current blocker: none
- Next exact step: monitor PR `#880` check run `23429106798` for commit `f5f7a2b` and only re-enter repair if either build job fails.
- Verification gap: none for the journal-rendering path; `npx tsx --test src/journal.test.ts` passes on the updated diff.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/core/journal.ts`, `src/journal.test.ts`
- Rollback concern: low; the patch only normalizes the rendered summary footer to the already-canonical `last_failure_signature` field and adds focused coverage.
- Last focused command: `npx tsx --test src/journal.test.ts`
- Last focused failure: the rendered journal snapshot kept `Failure signature: none` inside `Latest Codex Summary` while the live snapshot had already advanced to review signature `PRRT_kwDORgvdZ852EV-a`; the review thread is now resolved and fresh CI is pending on commit `f5f7a2b`.
- Last focused commands:
```bash
sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-873/AGENTS.generated.md
sed -n '1,260p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-873/context-index.md
sed -n '1,320p' .codex-supervisor/issue-journal.md
gh pr checks 880
gh run view 23427540544 --job 68145650746 --log
node -p "JSON.stringify(require('./package.json').scripts, null, 2)"
npm ci
sed -n '430,500p' src/backend/supervisor-http-server.test.ts
sed -n '740,820p' src/backend/supervisor-http-server.test.ts
sed -n '1,290p' src/supervisor/supervisor-service.test.ts
sed -n '1,220p' src/supervisor/supervisor-operator-activity-context.ts
sed -n '220,420p' src/supervisor/supervisor-operator-activity-context.ts
sed -n '1,180p' src/supervisor/supervisor-service.ts
sed -n '1,160p' src/supervisor/supervisor-status-report.ts
sed -n '1,180p' src/supervisor/supervisor-selection-issue-explain.ts
sed -n '1,180p' src/doctor.ts
apply_patch
npm run build
npx tsx --test src/supervisor/supervisor-service.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts src/supervisor/supervisor-selection-issue-explain.test.ts src/backend/supervisor-http-server.test.ts
git status --short --branch
date -u +%Y-%m-%dT%H:%M:%SZ
rg -n "Failure signature|Last failure signature|Repeated failure signature" .codex-supervisor src README.md docs -g '!node_modules'
nl -ba .codex-supervisor/issue-journal.md | sed -n '1,80p'
git diff -- .codex-supervisor/issue-journal.md
sed -n '240,360p' src/core/journal.ts
rg -n "Latest Codex Summary|Failure signature|Last failure signature|Repeated failure signature count" src/core src/supervisor -g '!node_modules'
sed -n '1,260p' src/journal.test.ts
sed -n '1,140p' src/codex/codex-output-parser.ts
apply_patch
npx tsx --test src/journal.test.ts
date -u +%Y-%m-%dT%H:%M:%SZ
git add .codex-supervisor/issue-journal.md src/core/journal.ts src/journal.test.ts
git commit -m "Normalize journal failure signature rendering"
git push origin codex/issue-873
gh api graphql -f query='mutation($threadId:ID!){resolveReviewThread(input:{threadId:$threadId}){thread{isResolved}}}' -f threadId='PRRT_kwDORgvdZ852EV-a'
gh pr checks 880
gh api graphql -f query='query($owner:String!,$repo:String!,$number:Int!){repository(owner:$owner,name:$repo){pullRequest(number:$number){reviewThreads(first:100){nodes{isResolved}}}}}' -f owner='TommyKammy' -f repo='codex-supervisor' -F number=880
date -u +%Y-%m-%dT%H:%M:%SZ
```
### Scratchpad
- 2026-03-23T08:56:21Z: pushed `f5f7a2b` to PR `#880`, resolved review thread `PRRT_kwDORgvdZ852EV-a`, confirmed all review threads are resolved, and observed a fresh GitHub Actions run `23429106798` with both `build` jobs pending.
- 2026-03-23T08:54:44Z: fixed the journal-rendering drift by canonicalizing the rendered summary `Failure signature:` line to `last_failure_signature`, added focused coverage in `src/journal.test.ts`, and updated the tracked journal snapshot to the active review-thread signature.
- 2026-03-23T08:38:54Z: reproduced the failing PR build from the GitHub Actions log, fixed the stale test doubles in `supervisor-http-server.test.ts` and `supervisor-service.test.ts`, and re-passed `npm run build` plus `npx tsx --test src/supervisor/supervisor-service.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts src/supervisor/supervisor-selection-issue-explain.test.ts src/backend/supervisor-http-server.test.ts`.
- 2026-03-23T08:10:30Z: reproduced the missing typed observability contract by tightening the focused service/status/explain tests, then passed the requested verification after extending the shared activity-context DTO with retry counts, repeated stale no-PR recovery metadata, and recovery-derived recent phase changes.
- 2026-03-23T07:22:48Z: validated the CodeRabbit flake note, added a DOM-order `waitForFunction` after the first pointer drag in `src/backend/webui-dashboard-browser-smoke.test.ts`, and re-passed `npx tsx --test src/backend/webui-dashboard.test.ts src/backend/webui-dashboard-browser-smoke.test.ts`.
- 2026-03-22T21:40:05Z: pushed `codex/issue-847` and opened draft PR `#857` for the verified dashboard refresh checkpoint.
- 2026-03-22T21:40:05Z: reproduced the visual-refresh gap with a new hero-and-section framing regression, refreshed the dashboard page chrome/CSS to add labeled lanes and flatter surfaces, and passed `npx tsx --test src/backend/webui-dashboard.test.ts src/backend/webui-dashboard-browser-logic.test.ts`.
- 2026-03-22T21:15:08Z: pushed `codex/issue-846` and opened draft PR `#856`; GitHub currently reports `mergeStateStatus=UNSTABLE`, so the next turn should inspect CI/check runs and address any failures or review feedback.
- 2026-03-22T21:14:15Z: confirmed there was no existing PR for `codex/issue-846`; next step is to push the branch and open a draft PR with commit `c4e2a04`.
- 2026-03-22T21:02:11Z: reproduced the issue with a new shell-structure regression, then passed the focused verification command after moving all dashboard panels onto a shared shell helper with a reserved drag slot and shared subtitle/meta/action lanes.
- 2026-03-22T20:06:27Z: committed the typed dashboard panel layout work as `a6f6ea0`, pushed `codex/issue-845`, and opened draft PR `#855` at https://github.com/TommyKammy/codex-supervisor/pull/855.
- 2026-03-22T20:04:56Z: added typed dashboard panel ids, registry, default layout state, and normalization in `src/backend/webui-dashboard-panel-layout.ts`, then switched `src/backend/webui-dashboard-page.ts` to render from the registry so DOM order is driven by typed layout data rather than duplicated markup order.
- 2026-03-22T20:04:56Z: added focused regressions in `src/backend/webui-dashboard-browser-logic.test.ts` and `src/backend/webui-dashboard.test.ts`; `npx tsx --test src/backend/webui-dashboard-browser-logic.test.ts src/backend/webui-dashboard.test.ts` passed twice on the local diff.
