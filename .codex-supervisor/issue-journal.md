# Issue #1082: Bound full issue inventory refresh cadence and reuse recent inventory results

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1082
- Branch: codex/issue-1082
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: stabilizing
- Attempt count: 2 (implementation=2, repair=0)
- Last head SHA: 84e8627793517d56d7eddad5c1cab9f0067c2899
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-26T17:49:35Z

## Latest Codex Summary
Implemented a bounded full-inventory reuse path in [supervisor.ts](src/supervisor/supervisor.ts). The loop prelude now uses a supervisor-local cached `listAllIssues()` result for 5 minutes, refreshes again once that TTL expires, and clears the cache if a refresh attempt fails. I added focused boundary tests in [supervisor.test.ts](src/supervisor/supervisor.test.ts), reran the focused supervisor verification, pushed branch `codex/issue-1082`, and opened draft PR #1088: https://github.com/TommyKammy/codex-supervisor/pull/1088

Verification passed with `npx tsx --test --test-name-pattern "listLoopIssueInventory" src/supervisor/supervisor.test.ts`, `npx tsx --test src/supervisor/supervisor.test.ts`, and `npm run build`. I still did not run the full repo test suite because `npm test -- <file>` expands to the repo-wide glob in this repo. The worktree still has untracked supervisor runtime artifacts under `.codex-supervisor/`, which I left alone.

Summary: Published the loop inventory cache checkpoint in draft PR #1088 after rerunning focused TTL-boundary tests and a clean build
State hint: draft_pr
Blocked reason: none
Tests: `npx tsx --test --test-name-pattern "listLoopIssueInventory" src/supervisor/supervisor.test.ts`; `npx tsx --test src/supervisor/supervisor.test.ts`; `npm run build`
Next action: Decide whether the 5 minute TTL should stay fixed or become config-derived, then open or update the PR
Failure signature: none

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the avoidable API pressure comes from `Supervisor.startRunOnceCycle()` always routing the prelude through a fresh `github.listAllIssues()` call, so a supervisor-local cache with a bounded TTL should reduce repeated full inventory reads without changing the loop’s correctness gates.
- What changed: added `listLoopIssueInventory()` in `src/supervisor/supervisor.ts`, cached successful full inventory reads for 5 minutes, invalidated the cache on refresh failure, and wired only the loop prelude’s `listAllIssues` path through that helper. Added focused tests in `src/supervisor/supervisor.test.ts` that verify reuse at `2026-03-20T00:04:59Z` after an initial fetch at `2026-03-20T00:00:00Z`, and verify a refresh occurs again at `2026-03-20T00:05:01Z`. Pushed the branch and opened draft PR #1088.
- Current blocker: none locally.
- Next exact step: review whether the fixed 5 minute TTL should stay hard-coded or be config-derived, then either keep the current draft PR moving or apply the smallest follow-up change needed for review.
- Verification gap: I did not run the entire suite because `npm test -- <file>` expands to the repo-wide test glob here; verification so far is the focused supervisor cache tests plus a full TypeScript build.
- Files touched: `src/supervisor/supervisor.ts`; `src/supervisor/supervisor.test.ts`; `.codex-supervisor/issue-journal.md`.
- Rollback concern: moderate. A too-long TTL would delay reconciliation of full-inventory-only state changes, so the remaining review question is whether 5 minutes is the right fixed bound.
- Last focused command: `gh pr create --draft --base main --head codex/issue-1082 ...`
- What changed this turn: reread the required memory files and journal, inspected the already-committed branch diff, reran the focused supervisor cache tests and a full TypeScript build on commit `84e8627`, pushed `codex/issue-1082` to origin, and opened draft PR #1088.
- Exact failure reproduced this turn: none; the existing checkpoint remained green under focused verification.
- Commands run this turn: `sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-1082/AGENTS.generated.md`; `sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-1082/context-index.md`; `sed -n '1,320p' .codex-supervisor/issue-journal.md`; `git status --short`; `git log --oneline --decorate -n 8`; `git diff --stat origin/main...HEAD`; `git diff origin/main...HEAD -- src/supervisor/supervisor.ts`; `git diff origin/main...HEAD -- src/supervisor/supervisor.test.ts`; `gh pr list --head codex/issue-1082 --json number,title,state,isDraft,url`; `npx tsx --test --test-name-pattern "listLoopIssueInventory" src/supervisor/supervisor.test.ts`; `npx tsx --test src/supervisor/supervisor.test.ts`; `npm run build`; `git branch -vv`; `git remote -v`; `date -u +"%Y-%m-%dT%H:%M:%SZ"`; `git push -u origin codex/issue-1082`; `gh pr create --draft --base main --head codex/issue-1082 --title "Issue #1082: bound loop issue inventory refresh cadence" --body ...`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
