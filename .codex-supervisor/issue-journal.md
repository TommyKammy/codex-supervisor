# Issue #920: Final evaluation follow-ups: create explicit residual follow-up issues when merge is allowed

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/920
- Branch: codex/issue-920
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 71295fb41972d9ee50cd590bc3c0d0ce0205698e
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-24T04:41:12.046Z

## Latest Codex Summary
- Added explicit residual follow-up issue creation for `follow_up_eligible` pre-merge final evaluations. The post-turn PR flow now turns each `follow_up_candidate` residual into an execution-ready GitHub issue that depends on the source issue, carries forward the parent epic when present, reuses the source verification section, and includes source-issue / PR / artifact traceability before the draft PR is allowed to proceed.

- Added a focused regression in `src/post-turn-pull-request.test.ts` that first reproduced the missing follow-up issue creation path, then verified the generated issue body keeps scheduler-compatible metadata (`Part of`, `Depends on`, `Execution order`, `Parallelizable`) and source traceability intact. Added `GitHubClient.createIssue()` to support the new path.

- Verification is green locally after restoring dependencies with `npm install`: `npx tsx --test src/post-turn-pull-request.test.ts`; `npx tsx --test src/post-turn-pull-request.test.ts src/supervisor/supervisor-pr-readiness.test.ts src/github/github.test.ts`; `npm run build`; `npx tsx --test src/**/*.test.ts`.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: `follow_up_eligible` final evaluations were persisted only as counts/outcome on the source record, so merge could proceed without creating explicit scheduler-visible residual follow-up issues.
- What changed: added focused regression coverage in `src/post-turn-pull-request.test.ts`; introduced follow-up issue drafting in `src/post-turn-pull-request.ts` that converts each `follow_up_candidate` residual into an execution-ready issue with inherited parent-epic metadata, `Depends on: #<source>`, `Execution order: 1 of 1`, `Parallelizable: Yes`, and explicit source traceability; added `GitHubClient.createIssue()` in `src/github/github.ts`; restored local dependencies so `npm run build` works in this worktree.
- Current blocker: none.
- Next exact step: review the diff, commit the follow-up-issue creation change, and open or update the branch PR if needed.
- Verification gap: none locally; focused post-turn regression, adjacent PR-readiness / GitHub tests, `npm run build`, and the full test suite are green in this workspace.
- Files touched: `src/post-turn-pull-request.ts`, `src/post-turn-pull-request.test.ts`, `src/github/github.ts`, `.codex-supervisor/issue-journal.md`
- Rollback concern: moderate; reverting would restore the previous silent gap where mergeable residual work was not turned into explicit follow-up issues, so operators would lose scheduler-visible tracking for bounded post-merge work.
- Last focused command: `npx tsx --test src/**/*.test.ts`
- Last focused failure: none
- Draft PR: none
- Last focused commands:
```bash
sed -n '1,240p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-920/AGENTS.generated.md
sed -n '1,240p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-920/context-index.md
sed -n '1,260p' .codex-supervisor/issue-journal.md
rg -n "follow_up|follow-up|follow up|final evaluation|residual" src .codex-supervisor -g '!node_modules'
sed -n '1,320p' src/post-turn-pull-request.ts
sed -n '1,260p' src/post-turn-pull-request.test.ts
sed -n '1,360p' src/github/github.ts
npx tsx --test src/post-turn-pull-request.test.ts
npx tsx --test src/post-turn-pull-request.test.ts src/supervisor/supervisor-pr-readiness.test.ts src/github/github.test.ts
npm install
npm run build
npx tsx --test src/**/*.test.ts
```
### Scratchpad
- Leave `.codex-supervisor/replay/` untracked; it is local replay output, not part of the fix.
