# Issue #927: Post-merge audit reporting: expose learning and promotion-candidate summaries to operators

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/927
- Branch: codex/issue-927
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: b9b8a5dd126403a3902abcb04ac3c44775750b01
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-24T11:54:02.506Z

## Latest Codex Summary
- Added a focused Web/API regression test proving the operator-facing post-merge audit summary was not exposed through the HTTP server: `GET /api/post-merge-audits/summary` returned `404`.
- Fixed the missing read-only route in the WebUI HTTP server so operators can query the advisory post-merge audit summary DTO without changing merge or scheduler behavior.
- Local verification required restoring the expected toolchain with `npm ci`; after that, the full `src/**/*.test.ts` suite and `npm run build` both passed.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the remaining gap for issue #927 was not the summary DTO itself but the lack of an operator-facing Web/API reporting surface for the already-generated advisory post-merge audit summary.
- What changed: added a focused HTTP server regression test for `GET /api/post-merge-audits/summary`, implemented the missing read-only route in the WebUI server, and verified the route returns the existing advisory summary DTO through the supervisor service boundary.
- Current blocker: none.
- Next exact step: commit the Web/API reporting fix on `codex/issue-927`, then decide whether to open or update the draft PR for this issue branch.
- Verification gap: none after installing dependencies locally with `npm ci`; focused HTTP-server coverage, the full `src/**/*.test.ts` suite, and `npm run build` all passed.
- Files touched: `src/backend/supervisor-http-server.ts`, `src/backend/supervisor-http-server.test.ts`, `.codex-supervisor/issue-journal.md`
- Rollback concern: low; reverting would only remove the read-only operator reporting route while leaving the underlying post-merge audit artifacts and CLI summary intact.
- Last focused command: `npm run build`
- Last focused failure: `GET /api/post-merge-audits/summary` returned `404` before the route was added; local build initially failed because `tsc` and `playwright-core` were unavailable until `npm ci` restored dependencies.
- Draft PR: none
- Last focused commands:
```bash
git status --short --branch
sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-927/AGENTS.generated.md
sed -n '1,240p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-927/context-index.md
sed -n '1,260p' .codex-supervisor/issue-journal.md
rg -n "summarize-post-merge-audits|queryPostMergeAuditSummary|postMergeAuditSummary|renderPostMergeAuditPatternSummaryDto" src
sed -n '1,260p' src/backend/supervisor-http-server.ts
sed -n '1,320p' src/backend/supervisor-http-server.test.ts
npx tsx --test src/backend/supervisor-http-server.test.ts
npm ci
npx tsx --test src/**/*.test.ts
npm run build
date -u +"%Y-%m-%dT%H:%M:%SZ"
git status --short
```
### Scratchpad
- Leave `.codex-supervisor/replay/` untracked; it is local replay output, not part of the fix.
