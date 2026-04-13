# Issue #1491: Same-head host-local blockers can be cleared as stale when blocker comment publication fails

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1491
- Branch: codex/issue-1491
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 2 (implementation=1, repair=1)
- Last head SHA: 1ebc994164cc74440b4cd9cef7efc9d12b4bacf3
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ856qw1j
- Repeated failure signature count: 1
- Updated at: 2026-04-13T22:42:53.013Z

## Latest Codex Summary
Recorded current-head host-local blocker observations separately from blocker-comment persistence, then used that observation in same-head ready-promotion freshness checks. That keeps workspace-preparation and workstation-local-path blockers authoritative after comment publication fails, while preserving the stale-path behavior for older records that lack current-head evidence.

The change is in commit `1ebc994` (`Preserve observed same-head host-local blockers`). I added focused regressions for post-turn comment-failure handling plus reconciliation, `status`, `explain`, and `doctor`, and the requested verification passed locally. The only remaining uncommitted items are supervisor-owned transient artifacts under `.codex-supervisor/`.

Summary: Preserved same-head host-local ready-promotion blockers by persisting current-head blocker observations independent of sticky-comment publication, added focused regressions, and committed the fix as `1ebc994`.
State hint: stabilizing
Blocked reason: none
Tests: `node --test --import tsx src/post-turn-pull-request.test.ts --test-name-pattern "comment posting fails|host-local blocker"`; `node --test --import tsx src/supervisor/supervisor-recovery-reconciliation.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts src/supervisor/supervisor-diagnostics-explain.test.ts src/doctor.test.ts`; `npm run build`
Next action: Push commit `1ebc994` and open or update the branch PR if the supervisor requests publication
Failure signature: PRRT_kwDORgvdZ856qw1j

## Active Failure Context
- Category: review
- Summary: 1 unresolved automated review thread(s) remain.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/1492#discussion_r3076208723
- Details:
  - src/post-turn-pull-request.ts:1506 summary=_⚠️ Potential issue_ | _🟠 Major_ **Workstation path-hygiene blockers can still lose fresh evidence on comment failure.** Line 1503 applies observed-blocker persistence for work... url=https://github.com/TommyKammy/codex-supervisor/pull/1492#discussion_r3076208723

## Codex Working Notes
### Current Handoff
- Hypothesis: The follow-up review correctly identified that three `workstation_local_path_hygiene` blocked-state writes still skipped `last_observed_host_local_pr_blocker_*`, so same-head path-hygiene blockers could still look stale when comment publication failed or normalization could not be published.
- What changed: Added `observedTrackedPrHostLocalBlockerPatch(...)` to the initial path-hygiene failure branch and both normalization-persistence failure branches in `handlePostTurnPullRequestTransitionsPhase`, added a focused `comment posting fails` regression for path-hygiene blockers, and extended the unpublished-normalization regression to assert the current-head observation is persisted.
- Current blocker: none
- Next exact step: Commit the review-fix delta, then push `codex/issue-1491` and update PR #1492 if publication is requested.
- Verification gap: none for the requested checks; the broader reconciliation suite still logs the same pre-existing execution-metrics chronology warnings in fixture scenarios, but the suite passes.
- Files touched: .codex-supervisor/issue-journal.md; src/post-turn-pull-request.ts; src/post-turn-pull-request.test.ts
- Rollback concern: The new observed-blocker fields are intentionally sticky across same-head reconciliation until a successful ready-promotion pass clears them; if another caller starts reusing those fields outside ready-promotion freshness checks, same-head stale classification could become too conservative.
- Last focused command: npm run build
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
