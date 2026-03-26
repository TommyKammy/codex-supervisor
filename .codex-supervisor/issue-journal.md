# Issue #1048: Converge parent epic closure when full inventory refresh is degraded

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1048
- Branch: codex/issue-1048
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: stabilizing
- Attempt count: 2 (implementation=2, repair=0)
- Last head SHA: 92af7a447f6d69e23f01238869923c7d14a8ab34
- Blocked reason: none
- Last failure signature: stale-stabilizing-no-pr-recovery-loop
- Repeated failure signature count: 0
- Updated at: 2026-03-26T06:28:42.793Z

## Latest Codex Summary
Implemented the degraded parent-epic closure fallback in [src/run-once-cycle-prelude.ts](src/run-once-cycle-prelude.ts) and wired it from [src/supervisor/supervisor.ts](src/supervisor/supervisor.ts). When full inventory refresh fails, the prelude now preserves `inventory_refresh_failure` and still evaluates parent-epic closure using tracked issue snapshots fetched via `getIssue()`, instead of returning before reconciliation.

Added the narrow regression in [src/run-once-cycle-prelude.test.ts](src/run-once-cycle-prelude.test.ts), pushed branch `codex/issue-1048`, and opened draft PR #1050. Checkpoint commit: `92af7a4` (`Handle degraded parent epic closure fallback`). The supervisor-local untracked artifacts under `.codex-supervisor/` are still uncommitted.

Summary: Added a tracked-issue fallback so degraded full-inventory refresh no longer prevents parent epic auto-closure, while keeping the degraded inventory diagnostic visible.
State hint: draft_pr
Blocked reason: none
Tests: `npx tsx --test src/run-once-cycle-prelude.test.ts`; `npx tsx --test src/supervisor/supervisor-recovery-reconciliation.test.ts`; `npx tsx --test src/supervisor/supervisor-diagnostics-status-selection.test.ts`; `npx tsx --test src/supervisor/supervisor-diagnostics-explain.test.ts`
Next action: monitor PR #1050 for review or CI feedback and address any follow-up if it appears
Failure signature: none

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: parent-epic closure is blocked specifically by the early degraded-inventory return in `runOnceCyclePrelude`; fetching tracked issue snapshots with `getIssue()` is narrow enough to evaluate already-known parent/child closure safely without reopening broad issue selection.
- What changed: added a focused degraded-inventory regression in `src/run-once-cycle-prelude.test.ts`; updated `src/run-once-cycle-prelude.ts` to fetch tracked issue snapshots for `reconcileParentEpicClosures` when `listAllIssues()` fails; wired the fallback through `src/supervisor/supervisor.ts`.
- Current blocker: none locally.
- Next exact step: review the final diff and commit the degraded parent-epic closure fallback checkpoint on `codex/issue-1048`.
- Verification gap: none in the requested local scope after rerunning the degraded inventory diagnostics suites.
- Files touched: `src/run-once-cycle-prelude.test.ts`, `src/run-once-cycle-prelude.ts`, `src/supervisor/supervisor.ts`, `.codex-supervisor/issue-journal.md`.
- Rollback concern: medium-low; the fallback intentionally limits degraded-mode reconciliation to already-tracked issue records, but widening the tracked record set too far in future changes could make degraded reconciliation slower.
- Last focused command: `gh pr create --draft --base main --head codex/issue-1048 --title "Converge parent epic closure when full inventory refresh is degraded" ...`
- Exact failure reproduced: when `listAllIssues()` failed, `runOnceCyclePrelude` persisted `inventory_refresh_failure` and returned before `reconcileParentEpicClosures`, so an open epic with already-closed tracked children stayed open until manual intervention.
- Commands run: `sed -n '1,220p' <redacted-local-path>`; `sed -n '1,260p' <redacted-local-path>`; `sed -n '1,320p' .codex-supervisor/issue-journal.md`; `git status --short --branch`; `git diff --stat origin/main...HEAD`; `git diff -- src/run-once-cycle-prelude.ts src/run-once-cycle-prelude.test.ts src/supervisor/supervisor.ts`; `gh pr status`; `git branch --show-current`; `npx tsx --test src/run-once-cycle-prelude.test.ts`; `npx tsx --test src/supervisor/supervisor-recovery-reconciliation.test.ts`; `git branch -vv`; `npx tsx --test src/supervisor/supervisor-diagnostics-status-selection.test.ts`; `npx tsx --test src/supervisor/supervisor-diagnostics-explain.test.ts`; `git show --stat --oneline --decorate HEAD`; `git remote -v`; `git push -u origin codex/issue-1048`; `gh pr create --draft --base main --head codex/issue-1048 --title "Converge parent epic closure when full inventory refresh is degraded" ...`.
- PR status: draft PR open at `https://github.com/TommyKammy/codex-supervisor/pull/1050`.
### Scratchpad
- Leave `.codex-supervisor/replay/` untracked; it is local replay output, not part of the fix.
