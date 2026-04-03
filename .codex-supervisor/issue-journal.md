# Issue #1281: Auto-resume failed no-PR issues when the workspace branch is already ahead and recoverable

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1281
- Branch: codex/issue-1281
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 6 (implementation=1, repair=5)
- Last head SHA: c3d26e5e74ddbc192266bac6f13b6ae58df1f513
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ854owd9
- Repeated failure signature count: 1
- Updated at: 2026-04-03T01:31:51.436Z

## Latest Codex Summary
Updated [recovery-reconciliation.ts](src/recovery-reconciliation.ts#L131) so failed no-PR recovery now also verifies the preserved worktree is still checked out on `record.branch` before classifying `HEAD` as recoverable. Added focused regressions in [supervisor-recovery-reconciliation.test.ts](src/supervisor/supervisor-recovery-reconciliation.test.ts#L3435) for a registered worktree switched to a different branch and for detached `HEAD`, both of which now fail closed to manual review.

Local verification passed with `npx tsx --test src/supervisor/supervisor-recovery-reconciliation.test.ts` and `npm run build`. I have not replied to or resolved the GitHub review thread.

Summary: Added a branch-identity guard to failed no-PR recovery, covered wrong-branch and detached-HEAD fallbacks with regressions, and verified the change locally.
State hint: addressing_review
Blocked reason: none
Tests: `npx tsx --test src/supervisor/supervisor-recovery-reconciliation.test.ts`; `npm run build`
Next action: Commit and push the review fix to PR #1282, then watch for refreshed review and CI status.
Failure signature: PRRT_kwDORgvdZ854owd9

## Active Failure Context
- Category: review
- Summary: 1 unresolved automated review thread(s) remain.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/1282#discussion_r3031030925
- Details:
  - src/recovery-reconciliation.ts:255 summary=_⚠️ Potential issue_ | _🟠 Major_ 🧩 Analysis chain 🏁 Script executed: Repository: TommyKammy/codex-supervisor Length of output: 3386 --- 🏁 Script executed: Repository: TommyK... url=https://github.com/TommyKammy/codex-supervisor/pull/1282#discussion_r3031030925

## Codex Working Notes
### Current Handoff
- Hypothesis: Failed no-PR records were stranded because stale-failed reconciliation skipped every `pr_number == null` record; a strict ahead-of-default-branch probe can safely auto-requeue transient no-PR failures.
- What changed: Tightened failed no-PR recovery so the branch probe only runs for registered supervisor worktrees, only when the preserved checkout still reports `record.branch`, canonicalizes worktree paths before comparison, classifies artifact-only ahead commits as `already_satisfied_on_main`, and uses the stale no-PR repeat budget instead of the implementation-lane gate.
- Current blocker: none
- Next exact step: Commit and push the branch-validation review fix, then watch PR #1282 for refreshed thread/CI state.
- Verification gap: Focused recovery reconciliation coverage passed and `npm run build` passed; I did not rerun the full `npm test` suite because the package script expands to the entire repository test matrix.
- Files touched: src/recovery-reconciliation.ts; src/supervisor/supervisor-recovery-reconciliation.test.ts; .codex-supervisor/issue-journal.md
- Rollback concern: The new worktree registration guard will refuse recovery for preserved checkouts that are safe Git clones but not actual supervisor worktrees; if any operator relied on clone-based recovery outside the managed worktree model, those cases now require manual review.
- Last focused command: npm run build
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
- CodeRabbit thread PRRT_kwDORgvdZ854owd9 was valid: the probe trusted `HEAD` inside a registered worktree without verifying it still matched `record.branch`.
- Added regressions for wrong-branch and detached-HEAD worktrees because both could otherwise misclassify foreign commits as recoverable no-PR state.
