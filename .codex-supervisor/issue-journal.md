# Issue #995: Orphan cleanup config safety: replace ambiguous negative grace behavior with explicit validated semantics

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/995
- Branch: codex/issue-995
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 2 (implementation=1, repair=1)
- Last head SHA: 47e7d2bfc5af7438f42a6a5bbde9bdae64d024ff
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ852uRmG
- Repeated failure signature count: 1
- Updated at: 2026-03-25T13:42:22.223Z

## Latest Codex Summary
Validated orphan cleanup grace config on [`src/core/config.ts`](src/core/config.ts) so `cleanupOrphanedWorkspacesAfterHours` now rejects negative values instead of silently disabling recent-workspace protection. I also hardened [`src/recovery-reconciliation.ts`](src/recovery-reconciliation.ts) to fail fast if an invalid negative is injected programmatically, added the focused regression in [`src/config.test.ts`](src/config.test.ts), and updated orphan-cleanup fixtures in [`src/supervisor/supervisor-execution-cleanup.test.ts`](src/supervisor/supervisor-execution-cleanup.test.ts) to use explicit non-negative semantics.

Branch `codex/issue-995` is pushed and draft PR `#1013` is open: https://github.com/TommyKammy/codex-supervisor/pull/1013. I also updated [`issue-journal.md`](.codex-supervisor/issue-journal.md). A broader probe of `src/supervisor/supervisor-execution-cleanup.test.ts` still showed two unrelated pre-existing failures outside this issue slice; the acceptance-targeted verification and build are green.

Summary: Rejected negative orphan cleanup grace values, added focused regression coverage, pushed branch, and opened draft PR #1013.
State hint: draft_pr
Blocked reason: none
Tests: `npx tsx --test src/config.test.ts`; `npx tsx --test src/config.test.ts src/doctor.test.ts src/recovery-reconciliation.test.ts`; `npm ci`; `npm run build`
Next action: Wait for review/CI on PR #1013 and address any follow-up if it appears
Failure signature: PRRT_kwDORgvdZ852uRmG

## Active Failure Context
- None active after resolving review thread `PRRT_kwDORgvdZ852uRmG`; PR #1013 is now waiting on check/mergeability refresh for head `dbdf6098b7b95ad1de012a6831f7836249faff3d`.

## Codex Working Notes
### Current Handoff
- Hypothesis: the CodeRabbit review finding was correct because `inspectOrphanedWorkspacePruneCandidates()` deferred orphan-grace validation until a candidate reached the recent-workspace branch; the fix now guarantees fail-fast validation even when workspace enumeration returns early.
- What changed: committed `dbdf609` (`Fail fast on invalid orphan prune grace`), pushed `codex/issue-995`, and resolved review thread `PRRT_kwDORgvdZ852uRmG` after moving `orphanedWorkspaceGracePeriodHours(config)` to function entry and adding the missing regression in `src/recovery-reconciliation.test.ts`.
- Current blocker: none.
- Next exact step: wait for PR #1013 checks/mergeability to settle after the pushed review fix and handle any new CI or review signal if it appears.
- Verification gap: none on the intended slice; `npx tsx --test src/recovery-reconciliation.test.ts src/config.test.ts src/doctor.test.ts` and `npm run build` are green after the review fix.
- Files touched: `src/recovery-reconciliation.ts`, `src/recovery-reconciliation.test.ts`, `.codex-supervisor/issue-journal.md`.
- Rollback concern: low; the behavior change is intentionally narrow to orphan-cleanup config validation and a defensive runtime assertion.
- Last focused command: `npm run build`
- Exact failure reproduced: the CodeRabbit finding was correct because `inspectOrphanedWorkspacePruneCandidates()` only called `orphanedWorkspaceGracePeriodHours(config)` inside the per-entry loop, so invalid injected config could bypass the runtime guard when `workspaceRoot` was unreadable or no orphan candidate reached the recent-workspace branch.
- Commands run: `sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-995/AGENTS.generated.md`; `sed -n '1,240p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-995/context-index.md`; `sed -n '1,260p' .codex-supervisor/issue-journal.md`; `git status --short --branch`; `sed -n '160,260p' src/recovery-reconciliation.ts`; `sed -n '340,410p' src/recovery-reconciliation.ts`; `rg -n "orphanedWorkspaceGracePeriodHours|cleanupOrphanedWorkspacesAfterHours" src/recovery-reconciliation.ts src/core/config.ts src/*.test.ts`; `sed -n '1,240p' src/recovery-reconciliation.test.ts`; `sed -n '1,220p' src/config.test.ts`; `sed -n '260,380p' src/recovery-reconciliation.ts`; `sed -n '1,120p' src/turn-execution-test-helpers.ts`; `git diff -- src/recovery-reconciliation.ts src/recovery-reconciliation.test.ts`; `npx tsx --test src/recovery-reconciliation.test.ts src/config.test.ts src/doctor.test.ts`; `npm run build`; `date -u +"%Y-%m-%dT%H:%M:%SZ"`; `sed -n '1,220p' .codex-supervisor/issue-journal.md`; `git add .codex-supervisor/issue-journal.md src/recovery-reconciliation.ts src/recovery-reconciliation.test.ts`; `git commit -m "Fail fast on invalid orphan prune grace"`; `git rev-parse HEAD`; `git push origin codex/issue-995`; `gh api graphql -f query='mutation($threadId:ID!){resolveReviewThread(input:{threadId:$threadId}){thread{isResolved}}}' -F threadId=PRRT_kwDORgvdZ852uRmG`; `gh pr view 1013 --json isDraft,reviewDecision,mergeStateStatus,headRefOid,url`.
- PR status: ready PR open at `https://github.com/TommyKammy/codex-supervisor/pull/1013`; current GitHub merge state is `UNSTABLE` immediately after pushing `dbdf6098b7b95ad1de012a6831f7836249faff3d`.
### Scratchpad
- Leave `.codex-supervisor/replay/` untracked; it is local replay output, not part of the fix.
