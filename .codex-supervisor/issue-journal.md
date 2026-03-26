# Issue #1080: Contain GitHub rate-limit failures without freezing active review progression

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1080
- Branch: codex/issue-1080
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 84fec3deca17014f43931777e142450ceae3caf9
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-26T16:11:16Z

## Latest Codex Summary
- Added rate-limit-aware inventory containment so `gh issue list` rate-limit failures degrade explicitly, avoid REST fallback hammering, and still allow active tracked review progression.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the containment gap is in broad inventory refresh classification and fallback behavior, not active-review reevaluation itself. A rate-limited `gh issue list` failure should degrade immediately and record rate-limited mode explicitly instead of falling through to broader inventory fallback.
- What changed: added distinct GitHub rate-limit detection in `src/github/github-transport.ts`, taught `src/github/github.ts` not to fall back to paginated REST inventory when the primary `gh issue list` failure is rate-limited, and recorded explicit `classification=rate_limited` inventory degradation in `src/inventory-refresh-state.ts` and state-store normalization.
- Current blocker: none.
- Next exact step: commit the rate-limit containment checkpoint on `codex/issue-1080`, then decide whether to open a draft PR now or extend coverage into additional rate-limited hydration paths.
- Verification gap: full `npm test` has not been run; focused rate-limit containment coverage is green.
- Files touched: `.codex-supervisor/issue-journal.md`; `src/core/state-store.ts`; `src/core/types.ts`; `src/github/github-transport.test.ts`; `src/github/github-transport.ts`; `src/github/github.test.ts`; `src/github/github.ts`; `src/inventory-refresh-state.ts`; `src/run-once-cycle-prelude.test.ts`; `src/supervisor/supervisor-pr-review-blockers.test.ts`.
- Rollback concern: low. The runtime behavior only changes broad inventory refresh classification and fallback decisions for rate-limited failures; malformed non-rate-limit inventory payloads still use the existing REST fallback path.
- Last focused command: `npx tsx --test src/github/github.test.ts`
- What changed this turn: reread the required memory files and journal, traced full inventory refresh through `GitHubClient.listAllIssues()` and `runOnceCyclePrelude()`, reproduced a rate-limited broad refresh with active tracked review context, added the narrow GitHub client regression proving rate-limited `gh issue list` output must not fall through to REST fallback, implemented explicit rate-limit classification, and reran focused supervisor verification.
- Exact failure reproduced this turn: a full inventory refresh rate-limit failure was not classified distinctly, and the broad refresh path could continue into fallback inventory reads instead of degrading explicitly, obscuring the operator-facing mode during active tracked review progression.
- Commands run this turn: `sed -n '1,220p' <always-read-memory>`; `sed -n '1,260p' <context-index>`; `sed -n '1,320p' .codex-supervisor/issue-journal.md`; `git status --short --branch`; `rg -n "rate limit|rate-limit|secondary rate|GraphQL|inventory refresh|active review|review progression|hydrate|prelude|GitHub command|GitHub.*fail|refresh" src test`; `rg --files src test | rg "supervisor|review|github|inventory|prelude|hydrate|loop|scheduler"`; `gh pr view --json number,url,isDraft,headRefName,baseRefName,state`; `sed -n '1,260p' src/run-once-cycle-prelude.ts`; `sed -n '1,320p' src/run-once-cycle-prelude.test.ts`; `sed -n '260,620p' src/supervisor/supervisor-pr-review-blockers.test.ts`; `sed -n '1,220p' src/inventory-refresh-state.ts`; `sed -n '1,260p' src/github/github-transport.ts`; `sed -n '1,260p' src/github/github-transport.test.ts`; `sed -n '1,260p' src/core/types.ts`; `rg -n "inventory_refresh_failure|recorded_at|source=gh issue list|buildInventoryRefreshFailure|formatInventoryRefreshStatusLine|isTransientGitHubCommandFailure|rate limit" src`; `sed -n '240,360p' src/run-once-issue-selection.ts`; `sed -n '500,580p' src/run-once-issue-selection.ts`; `sed -n '100,180p' src/supervisor/supervisor-status-report.ts`; `sed -n '180,240p' src/supervisor/supervisor-selection-issue-explain.ts`; `sed -n '1,220p' src/github/github.ts`; `sed -n '220,420p' src/github/github.ts`; `sed -n '420,700p' src/github/github.ts`; `sed -n '420,520p' src/github/github.test.ts`; `sed -n '1,120p' src/github/github.test.ts`; `rg -n "listAllIssues preserves|listAllIssuesViaRestApi|rate limit|rate-limit" src/github/github.test.ts src/run-once-cycle-prelude.test.ts src/supervisor/supervisor-pr-review-blockers.test.ts`; `sed -n '430,640p' src/run-once-cycle-prelude.test.ts`; `sed -n '1,220p' src/core/state-store.ts`; `apply_patch ...`; `npx tsx --test src/github/github-transport.test.ts`; `npx tsx --test src/github/github.test.ts`; `npx tsx --test src/run-once-cycle-prelude.test.ts`; `npx tsx --test src/supervisor/supervisor-pr-review-blockers.test.ts`; `apply_patch ...`; `npx tsx --test src/github/github.test.ts`; `npx tsx --test src/github/github-transport.test.ts src/run-once-cycle-prelude.test.ts src/supervisor/supervisor-pr-review-blockers.test.ts`; `git status --short`; `git diff -- <touched files>`; `date -u +"%Y-%m-%dT%H:%M:%SZ"`.
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
