# Issue #1082: Bound full issue inventory refresh cadence and reuse recent inventory results

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1082
- Branch: codex/issue-1082
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 3 (implementation=2, repair=1)
- Last head SHA: 722f1a44416a93d5a9a46580ef18c684029fd0f6
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ853GE78
- Repeated failure signature count: 1
- Updated at: 2026-03-26T17:56:13.357Z

## Latest Codex Summary
Addressed the remaining CodeRabbit review on draft PR [#1088](https://github.com/TommyKammy/codex-supervisor/pull/1088) by fixing the two journal prose uses of `5-minute TTL`, committing the journal-only wording change as `35eccef`, pushing `codex/issue-1082`, and resolving the review thread through GitHub.

I left the existing untracked supervisor runtime artifacts under `.codex-supervisor/` alone. No code paths changed this turn, so verification stayed limited to a whitespace check and a targeted journal-content search after the wording fix.

Summary: Pushed a journal-only review fix to PR #1088 and resolved the remaining CodeRabbit thread
State hint: addressing_review
Blocked reason: none
Tests: `git diff --check`; `rg -n "5 minute TTL" .codex-supervisor/issue-journal.md`
Next action: Monitor PR #1088 for follow-up review; if the TTL question resurfaces, decide whether the fixed 5-minute inventory reuse TTL should stay hard-coded or become config-derived
Failure signature: none

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the avoidable API pressure comes from `Supervisor.startRunOnceCycle()` always routing the prelude through a fresh `github.listAllIssues()` call, so a supervisor-local cache with a bounded TTL should reduce repeated full inventory reads without changing the loop’s correctness gates.
- What changed: added `listLoopIssueInventory()` in `src/supervisor/supervisor.ts`, cached successful full inventory reads for 5 minutes, invalidated the cache on refresh failure, and wired only the loop prelude’s `listAllIssues` path through that helper. Added focused tests in `src/supervisor/supervisor.test.ts` that verify reuse at `2026-03-20T00:04:59Z` after an initial fetch at `2026-03-20T00:00:00Z`, and verify a refresh occurs again at `2026-03-20T00:05:01Z`. Pushed the branch and opened draft PR #1088.
- Current blocker: none locally.
- Next exact step: monitor PR #1088 for any follow-up review; if none appears, keep the branch ready while the fixed 5-minute TTL versus config-derived TTL question remains under review.
- Verification gap: I did not run the entire suite because `npm test -- <file>` expands to the repo-wide test glob here; verification so far is the focused supervisor cache tests plus a full TypeScript build.
- Files touched: `src/supervisor/supervisor.ts`; `src/supervisor/supervisor.test.ts`; `.codex-supervisor/issue-journal.md`.
- Rollback concern: moderate. A too-long TTL would delay reconciliation of full-inventory-only state changes, so the remaining review question is whether 5 minutes is the right fixed bound.
- Last focused command: `gh api graphql -f query='mutation($threadId:ID!){resolveReviewThread(input:{threadId:$threadId}){thread{isResolved}}}' -F threadId='PRRT_kwDORgvdZ853GE78'`
- What changed this turn: reread the required memory files and current journal, accepted the CodeRabbit wording fix, updated the two prose mentions to `5-minute TTL`, committed the journal-only change as `35eccef`, pushed `codex/issue-1082`, and resolved review thread `PRRT_kwDORgvdZ853GE78`.
- Exact failure reproduced this turn: the only reproducible issue was the journal prose wording in the existing review comment; it is now fixed locally and resolved on the PR.
- Commands run this turn: `sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-1082/AGENTS.generated.md`; `sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-1082/context-index.md`; `sed -n '1,260p' .codex-supervisor/issue-journal.md`; `git status --short`; `rg -n "5 minute TTL|5-minute TTL" .codex-supervisor/issue-journal.md`; `date -u +"%Y-%m-%dT%H:%M:%SZ"`; `git diff -- .codex-supervisor/issue-journal.md`; `git diff --check`; `git add .codex-supervisor/issue-journal.md`; `git commit -m "chore: fix issue journal ttl wording"`; `git push origin codex/issue-1082`; `gh api graphql -f query='mutation($threadId:ID!){resolveReviewThread(input:{threadId:$threadId}){thread{isResolved}}}' -F threadId='PRRT_kwDORgvdZ853GE78'`; `sed -n '1,220p' .codex-supervisor/issue-journal.md`; `date -u +"%Y-%m-%dT%H:%M:%SZ"`; `git status --short`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
