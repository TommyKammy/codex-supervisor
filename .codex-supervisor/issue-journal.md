# Issue #1068: Restrict degraded inventory fallback to targeted non-authoritative reconciliations

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1068
- Branch: codex/issue-1068
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: draft_pr
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 2d45ec1f7efb036e2d4f12ea3fe7811cfe1a80c7
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-26T14:35:08Z

## Latest Codex Summary
- Tightened degraded inventory handling at the active-issue selection boundary. `resolveRunnableIssueContext` now keeps a degraded cycle pinned to the already-active record instead of broad candidate discovery, uses fresh targeted `getIssue()` reads to recheck explicit `Depends on:` constraints, and refuses to continue execution-order constrained issues while full inventory refresh is degraded because that would require broad inventory authority.
- Added focused unit coverage in `src/run-once-issue-selection.test.ts` for both sides of the boundary: targeted dependency rechecks are still allowed without `listCandidateIssues()`, while execution-order constrained active issues are requeued with an explicit degraded-state warning instead of consulting backlog inventory.
- Local verification now passes after bootstrapping the worktree with `npm ci`: focused degraded-inventory tests pass and `npm run build` succeeds.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the real authority leak was not in `runOnceCyclePrelude`; it was in active-issue selection, where degraded cycles could still fall back to `listCandidateIssues()` for active records with sequencing metadata. Restricting degraded mode at that boundary should satisfy the issue without weakening the existing active-PR targeted reconciliation path.
- What changed: added `evaluateDegradedActiveIssueDependencies()` in `src/run-once-issue-selection.ts`; degraded cycles now reuse the current active record without broad candidate discovery; explicit dependency checks in degraded mode use targeted `getIssue()` reads plus tracked-record completion state; execution-order constrained active issues now requeue with an explicit degraded warning instead of consulting broad inventory.
- Current blocker: none.
- Next exact step: watch draft PR #1075 CI and extend coverage only if a review signal finds another degraded-inventory authority leak.
- Verification gap: full `npm test` has not been run yet; focused degraded-inventory coverage and `npm run build` are green.
- Files touched: `.codex-supervisor/issue-journal.md`; `src/run-once-issue-selection.ts`; `src/run-once-issue-selection.test.ts`.
- Rollback concern: low. The behavior change is localized to degraded active-issue selection and only narrows when broad inventory can be consulted.
- Last focused command: `gh pr create --draft --base main --head codex/issue-1068 --title "Issue #1068: restrict degraded inventory fallback" --body ...`
- What changed this turn: reread the required memory files and journal, traced degraded inventory behavior through `runOnceCyclePrelude`, `resolveRunnableIssueContext`, and supervisor tests, reproduced the broad candidate-inventory leak with a new focused unit test, changed degraded active-issue selection to stay on the current record and use targeted dependency fetches only, added a second unit test proving execution-order constrained issues are explicitly requeued while degraded, installed local dependencies with `npm ci`, reran focused tests plus build verification, committed the change as `6464b87`, pushed `codex/issue-1068`, and opened draft PR #1075.
- Exact failure reproduced this turn: before the fix, degraded active-issue handling still called `listCandidateIssues()` for sequencing checks instead of staying on targeted `getIssue()` reads; the new focused test in `src/run-once-issue-selection.test.ts` caught that path directly.
- Commands run this turn: `sed -n '1,220p' <always-read-memory>`; `sed -n '1,260p' <context-index>`; `sed -n '1,260p' .codex-supervisor/issue-journal.md`; `git status --short --branch`; `rg -n "degraded|inventory refresh|reconciliation|targeted|authoritative" src`; `sed -n '430,660p' src/run-once-cycle-prelude.test.ts`; `sed -n '1,260p' src/run-once-cycle-prelude.ts`; `sed -n '260,540p' src/supervisor/supervisor-pr-review-blockers.test.ts`; `sed -n '1,260p' src/recovery-reconciliation.ts`; `sed -n '1,360p' src/run-once-issue-selection.ts`; `sed -n '1,860p' src/run-once-issue-selection.test.ts`; `sed -n '1,220p' src/issue-metadata/issue-metadata.ts`; `apply_patch ...`; `npx tsx --test src/run-once-issue-selection.test.ts`; `npx tsx --test src/supervisor/supervisor-pr-review-blockers.test.ts`; `npx tsx --test src/run-once-issue-selection.test.ts src/run-once-cycle-prelude.test.ts src/supervisor/supervisor-pr-review-blockers.test.ts`; `test -d node_modules && echo present || echo missing`; `test -f package-lock.json && echo package-lock || echo no-lock`; `npm ci`; `npm run build`; `git rev-parse HEAD`; `date -u +"%Y-%m-%dT%H:%M:%SZ"`; `git add .codex-supervisor/issue-journal.md src/run-once-issue-selection.ts src/run-once-issue-selection.test.ts`; `git commit -m "Restrict degraded inventory fallback"`; `git push -u origin codex/issue-1068`; `gh pr create --draft --base main --head codex/issue-1068 --title "Issue #1068: restrict degraded inventory fallback" --body ...`.
