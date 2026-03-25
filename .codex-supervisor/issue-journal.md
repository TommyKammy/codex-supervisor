# Issue #995: Orphan cleanup config safety: replace ambiguous negative grace behavior with explicit validated semantics

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/995
- Branch: codex/issue-995
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 3 (implementation=1, repair=2)
- Last head SHA: e44e30546993970cbc765a07e141fe69c9448f58
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 1
- Updated at: 2026-03-25T13:55:44Z

## Latest Codex Summary
Corrected the issue journal handoff text so PR `#1013` consistently reflects the live GitHub state for branch `codex/issue-995`, committed the journal-only fix as head `e44e30546993970cbc765a07e141fe69c9448f58`, pushed it, and resolved the remaining CodeRabbit thread `PRRT_kwDORgvdZ852udeJ`.

The PR remains ready (`isDraft=false`). After the fresh push, GitHub has temporarily returned `mergeStateStatus=UNSTABLE` again while mergeability refreshes on the new head, which matches the expected post-push behavior rather than a new review failure.

Summary: Corrected the journal's PR status wording, pushed the journal-only review fix, and resolved the remaining CodeRabbit thread on PR #1013
State hint: waiting_ci
Blocked reason: none
Tests: not run; verified review-fix state with `gh pr view 1013 --json isDraft,mergeStateStatus,headRefOid,url`
Next action: Wait for PR #1013 checks and mergeability to refresh on head `e44e30546993970cbc765a07e141fe69c9448f58`, then handle any new CI or review signal if it appears
Failure signature: none

## Active Failure Context
- None active after resolving review thread `PRRT_kwDORgvdZ852udeJ`; PR #1013 is waiting on post-push check and mergeability refresh for head `e44e30546993970cbc765a07e141fe69c9448f58`.

## Codex Working Notes
### Current Handoff
- Hypothesis: the CodeRabbit finding was valid because the journal mixed stale PR-state snapshots; the wording fix is now pushed, the thread is resolved, and the only remaining churn is GitHub's normal mergeability refresh on the new head.
- What changed: updated the journal wording for PR `#1013`, committed it as `e44e30546993970cbc765a07e141fe69c9448f58`, pushed `codex/issue-995`, and resolved review thread `PRRT_kwDORgvdZ852udeJ`.
- Current blocker: none.
- Next exact step: wait for GitHub to refresh checks and mergeability on PR `#1013`, then react only if new CI or review signal appears.
- Verification gap: none for this docs-only review fix; the live PR metadata and review-thread resolution were re-queried after the push.
- Files touched: `.codex-supervisor/issue-journal.md`.
- Rollback concern: low; the behavior change is intentionally narrow to orphan-cleanup config validation and a defensive runtime assertion.
- Last focused command: `gh pr view 1013 --json isDraft,mergeStateStatus,headRefOid,url`
- Exact failure reproduced: the journal had conflicting PR-state snapshots across turns; fixing that wording resolved the remaining review thread, and the current `UNSTABLE` status only appeared after pushing the journal sync commit.
- Commands run: `sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-995/AGENTS.generated.md`; `sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-995/context-index.md`; `sed -n '1,260p' .codex-supervisor/issue-journal.md`; `rg -n "draft PR|ready PR open|PR status|isDraft|UNSTABLE|CLEAN" .codex-supervisor/issue-journal.md`; `gh pr view 1013 --json isDraft,reviewDecision,mergeStateStatus,headRefOid,url`; `git status --short --branch`; `git diff -- .codex-supervisor/issue-journal.md`; `date -u +"%Y-%m-%dT%H:%M:%SZ"`; `git add .codex-supervisor/issue-journal.md`; `git commit -m "Clarify review journal PR status"`; `git rev-parse HEAD`; `git push origin codex/issue-995`; `gh api graphql -f query='mutation($threadId:ID!){resolveReviewThread(input:{threadId:$threadId}){thread{isResolved}}}' -F threadId=PRRT_kwDORgvdZ852udeJ`; `gh pr view 1013 --json isDraft,mergeStateStatus,headRefOid,url`; `git status --short --branch`
- PR status: ready PR open at `https://github.com/TommyKammy/codex-supervisor/pull/1013`; current GitHub metadata reports `isDraft=false` and `mergeStateStatus=UNSTABLE` on head `e44e30546993970cbc765a07e141fe69c9448f58`.
### Scratchpad
- Leave `.codex-supervisor/replay/` untracked; it is local replay output, not part of the fix.
