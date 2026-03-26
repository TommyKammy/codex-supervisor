# Issue #1082: Bound full issue inventory refresh cadence and reuse recent inventory results

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1082
- Branch: codex/issue-1082
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: fc4a6db902bf5cbfff5a27d668c8800db7d0819b
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-26T17:34:26.997Z

## Latest Codex Summary
- Added a supervisor-local 5 minute full-issue-inventory reuse window for the loop prelude so repeated cycles reuse recent `listAllIssues()` results instead of refetching on every cycle. The loop now invalidates the cached inventory on refresh failure and falls back to a fresh fetch after the TTL expires.

- Added focused supervisor tests that stub `Date.now()` around the cache helper and prove both boundaries: reuse inside the TTL and refresh after the TTL expires. Verified with `npx tsx --test src/supervisor/supervisor.test.ts` and `npm run build`.

- Summary: bounded loop inventory refreshes with a 5 minute TTL and added focused cache-boundary tests
- State hint: implementing
- Blocked reason: none
- Tests: `npx tsx --test --test-name-pattern "listLoopIssueInventory" src/supervisor/supervisor.test.ts`; `npx tsx --test src/supervisor/supervisor.test.ts`; `npm run build`
- Next action: review whether the 5 minute TTL should remain fixed or become config-derived before opening or updating the PR
- Failure signature: none

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the avoidable API pressure comes from `Supervisor.startRunOnceCycle()` always routing the prelude through a fresh `github.listAllIssues()` call, so a supervisor-local cache with a bounded TTL should reduce repeated full inventory reads without changing the loop’s correctness gates.
- What changed: added `listLoopIssueInventory()` in `src/supervisor/supervisor.ts`, cached successful full inventory reads for 5 minutes, invalidated the cache on refresh failure, and wired only the loop prelude’s `listAllIssues` path through that helper. Added focused tests in `src/supervisor/supervisor.test.ts` that verify reuse at `2026-03-20T00:04:59Z` after an initial fetch at `2026-03-20T00:00:00Z`, and verify a refresh occurs again at `2026-03-20T00:05:01Z`.
- Current blocker: none locally.
- Next exact step: commit the loop-inventory cache change, then decide whether to keep the TTL fixed at 5 minutes or derive it from config before opening or updating a PR.
- Verification gap: I did not run the entire suite because `npm test -- <file>` expands to the repo-wide test glob here; verification so far is the focused supervisor cache tests plus a full TypeScript build.
- Files touched: `src/supervisor/supervisor.ts`; `src/supervisor/supervisor.test.ts`; `.codex-supervisor/issue-journal.md`.
- Rollback concern: moderate. A too-long TTL would delay reconciliation of full-inventory-only state changes, so the remaining review question is whether 5 minutes is the right fixed bound.
- Last focused command: `npm run build`
- What changed this turn: reread the required memory files and journal, traced the full inventory refresh path to `Supervisor.startRunOnceCycle() -> runOnceCyclePrelude() -> github.listAllIssues()`, added a 5 minute supervisor-local reuse cache plus failure invalidation, replaced the heavier first draft integration test with focused cache-boundary tests on `listLoopIssueInventory()`, installed local dependencies with `npm ci`, and verified the change with focused tests and a full build.
- Exact failure reproduced this turn: repeated loop cycles would always invoke a fresh full `listAllIssues()` refresh because the prelude path had no reuse policy at all; the focused cache-boundary tests now prove reuse inside the TTL and a new fetch immediately after the TTL boundary.
- Commands run this turn: `sed -n '1,220p' <local-memory>/TommyKammy-codex-supervisor/issue-1082/AGENTS.generated.md`; `sed -n '1,220p' <local-memory>/TommyKammy-codex-supervisor/issue-1082/context-index.md`; `sed -n '1,260p' .codex-supervisor/issue-journal.md`; `git status --short`; `rg -n "inventory|refresh cadence|full issue inventory|listIssues|issues inventory|refresh" -S .`; `rg --files . | rg "test|spec|__tests__|src|lib"`; `sed -n '1,260p' src/run-once-cycle-prelude.ts`; `sed -n '1,260p' src/run-once-issue-selection.ts`; `sed -n '1,260p' src/run-once-cycle-prelude.test.ts`; `rg -n "listAllIssues\\(|reserveRunnableIssueSelection\\(|runOnceCyclePrelude\\(" src -S`; `sed -n '1,260p' src/run-once-issue-selection.test.ts`; `sed -n '260,520p' src/run-once-issue-selection.ts`; `rg -n "inventory_refresh_failure|activeIssueNumber|pollIntervalSeconds|candidateDiscoveryFetchWindow" src/core/types.ts src/core/state-store.ts src/core/config.ts -S`; `sed -n '240,380p' src/core/types.ts`; `sed -n '1440,1515p' src/supervisor/supervisor.ts`; `rg -n "listAllIssues|startRunOnceCycle|runOnce\\(|pollIntervalSeconds|Date.now|nowIso\\(" src/supervisor/*.test.ts src/*.test.ts -S`; `sed -n '1,260p' src/supervisor/supervisor.test.ts`; `sed -n '1,260p' src/supervisor/supervisor-lifecycle.test.ts`; `sed -n '880,980p' src/supervisor/supervisor-execution-cleanup.test.ts`; `sed -n '1,220p' src/supervisor/supervisor-test-helpers.ts`; `sed -n '1,220p' src/supervisor/index.ts`; `sed -n '1,220p' src/supervisor/supervisor.ts`; `sed -n '220,420p' src/supervisor/supervisor.ts`; `rg -n "class Supervisor|constructor\\(|private readonly github|private .*stateStore|private .*config" src/supervisor/supervisor.ts -S`; `sed -n '423,520p' src/supervisor/supervisor.ts`; `sed -n '1,220p' src/supervisor/supervisor-execution-orchestration.test.ts`; `sed -n '820,910p' src/supervisor/supervisor-execution-orchestration.test.ts`; `apply_patch ...`; `npm test -- src/supervisor/supervisor-execution-orchestration.test.ts`; `sed -n '1,220p' package.json`; `ls -1`; `test -d node_modules && echo yes || echo no`; `npm ci`; `npx tsx --test --test-name-pattern "listLoopIssueInventory" src/supervisor/supervisor.test.ts`; `npx tsx --test src/supervisor/supervisor.test.ts`; `npm run build`; `git diff -- src/supervisor/supervisor.ts src/supervisor/supervisor.test.ts src/supervisor/supervisor-execution-orchestration.test.ts .codex-supervisor/issue-journal.md`; `date -u +"%Y-%m-%dT%H:%M:%SZ"`.
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
