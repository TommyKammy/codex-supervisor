# Issue #1152: Rehydrate tracked PR-open issues from live GitHub facts at cycle start

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1152
- Branch: codex/issue-1152
- Workspace: .
- Journal: .codex-supervisor/issues/1152/issue-journal.md
- Current phase: stabilizing
- Attempt count: 3 (implementation=3, repair=0)
- Last head SHA: 990219fff88edc5a07571723f99fc8b0dfa2b16b
- Blocked reason: none
- Last failure signature: stale-stabilizing-no-pr-recovery-loop
- Repeated failure signature count: 0
- Updated at: 2026-03-28T04:38:00.507Z

## Latest Codex Summary
Added a small test-only stabilization commit, `990219f` (`Fix orchestration fixture labels for stale no-PR recovery`).

The actual issue implementation remains the earlier tracked-PR rehydration work. This turn fixed the remaining red orchestration test by making the raw `GitHubIssue` fixtures explicit about `labels: []`, which matches the current metadata contract where missing labels are blocked as `metadata:labels_unavailable` rather than treated as unlabeled. I also updated the issue journal with the failure cause, commands run, and current handoff.

Verification passed:
- `npx tsx --test src/supervisor/supervisor-execution-orchestration.test.ts`
- `npx tsx --test src/run-once-cycle-prelude.test.ts src/supervisor/supervisor-recovery-reconciliation.test.ts`

There are still non-fatal execution-metrics chronology warnings emitted during some tests, but they did not fail either suite and were not changed here.

Summary: Fixed the remaining stale no-PR orchestration test by adding explicit empty labels to raw issue fixtures, updated the journal, and committed a clean stabilization checkpoint.
State hint: stabilizing
Blocked reason: none
Tests: `npx tsx --test src/supervisor/supervisor-execution-orchestration.test.ts` passed; `npx tsx --test src/run-once-cycle-prelude.test.ts src/supervisor/supervisor-recovery-reconciliation.test.ts` passed
Next action: Keep the branch as the current reviewable checkpoint, or open/update the draft PR if you want this checkpoint published now.
Failure signature: stale-stabilizing-no-pr-recovery-loop

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the branch is now at a reviewable checkpoint. The tracked-PR rehydration implementation and the later orchestration-fixture stabilization both hold under focused local verification, so the remaining work is publication rather than more runtime changes.
- What changed: no new runtime code this turn. I re-read the branch diff, reverified the targeted suites, and confirmed the implementation still covers both selection-order rehydration and same-head blocked-PR recovery from fresh GitHub facts. I also confirmed `gh` auth is healthy and there is not yet a PR for `codex/issue-1152`.
- Current blocker: none.
- Next exact step: commit this journal refresh if desired, push `codex/issue-1152`, and open a draft PR against `main` so the current checkpoint is reviewable.
- Verification gap: none in the intended issue path. Focused suites are green. There are still pre-existing non-fatal execution-metrics chronology warnings in some tests, but they did not fail the runs and were not changed here.
- Files touched: src/run-once-cycle-prelude.ts; src/recovery-reconciliation.ts; src/supervisor/supervisor.ts; src/run-once-cycle-prelude.test.ts; src/supervisor/supervisor-recovery-reconciliation.test.ts; src/supervisor/supervisor-execution-orchestration.test.ts
- Rollback concern: low for this checkpoint; the new edit is test-only and constrains fixtures to supply labels explicitly.
- Last focused commands: `npx tsx --test src/run-once-cycle-prelude.test.ts`; `npx tsx --test src/supervisor/supervisor-recovery-reconciliation.test.ts`; `npx tsx --test src/supervisor/supervisor-execution-orchestration.test.ts`; `gh auth status`; `gh repo view --json nameWithOwner,defaultBranchRef`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
