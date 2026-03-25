# Issue #975: Selected runnable issue can starve behind repeated reconciliation before claim

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/975
- Branch: codex/issue-975
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 2af9471670be918fcc0d160ad6ac0d1cb5f03473
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-25T09:05:11.094Z

## Latest Codex Summary
- Reserved runnable issues before the broad reconciliation sweep so `runOnce()` can claim and start selected work without touching unrelated tracked PRs first.
- Added a focused orchestration regression covering a runnable selection with `activeIssueNumber=null` and an unrelated tracked PR that would previously have been reconciled before claim.
- Local verification passed for `npx tsx --test src/run-once-issue-selection.test.ts`, `npx tsx --test src/run-once-cycle-prelude.test.ts`, `npx tsx --test src/supervisor/supervisor-execution-orchestration.test.ts`, and `npm run build` after installing missing dev dependencies with `npm install`.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: when `activeIssueNumber` is still `null`, the prelude can spend a full cycle in unrelated reconciliation before the selected runnable issue is ever reserved, so repeated runs can keep restarting broad reconciliation without ever claiming the chosen work.
- What changed: added `reserveRunnableIssueSelection()` in `src/run-once-issue-selection.ts`, invoked it from `src/supervisor/supervisor.ts` before the broad prelude reconciliation, and taught `src/run-once-cycle-prelude.ts` to return early once a runnable issue has been reserved so the normal issue phase can claim/start it immediately. Added a focused regression in `src/supervisor/supervisor-execution-orchestration.test.ts` that throws if unrelated tracked-PR reconciliation runs before the selected runnable issue is claimed.
- Current blocker: none.
- Next exact step: review the diff, commit the runnable-reservation fast path on `codex/issue-975`, and open or update a draft PR if needed.
- Verification gap: none in the requested local scope after rerunning `npx tsx --test src/run-once-issue-selection.test.ts`, `npx tsx --test src/run-once-cycle-prelude.test.ts`, `npx tsx --test src/supervisor/supervisor-execution-orchestration.test.ts`, and `npm run build`.
- Files touched: `src/run-once-issue-selection.ts`, `src/run-once-cycle-prelude.ts`, `src/supervisor/supervisor.ts`, `src/supervisor/supervisor-execution-orchestration.test.ts`, `.codex-supervisor/issue-journal.md`.
- Rollback concern: low; the change only reorders the reservation boundary so runnable work is claimed before unrelated reconciliation, while leaving the existing selection logic and reconciliation behavior intact for later cycles.
- Last focused command: `npm run build`
- Exact failure reproduced: with `activeIssueNumber=null`, runnable issue #91 returned from `listCandidateIssues()`, and unrelated issue #92 already tracking PR #192, `runOnce()` hit broad tracked-PR reconciliation before claim; the focused regression throws `unrelated reconciliation touched PR #192 before selected issue #91 was claimed` unless the runnable issue is reserved first.
- Commands run: `npx tsx --test src/supervisor/supervisor-execution-orchestration.test.ts --test-name-pattern "runOnce reserves a runnable issue before unrelated tracked-PR reconciliation work"`; `npx tsx --test src/run-once-issue-selection.test.ts`; `npx tsx --test src/run-once-cycle-prelude.test.ts`; `npx tsx --test src/supervisor/supervisor-execution-orchestration.test.ts`; `npm run build`; `npm install`; `npm run build`.
- PR status: none.
### Scratchpad
- Leave `.codex-supervisor/replay/` untracked; it is local replay output, not part of the fix.
