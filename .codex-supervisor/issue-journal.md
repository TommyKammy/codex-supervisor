# Issue #1518: Tracked-PR reconciliation should not spend residual default budget on historical done records

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1518
- Branch: codex/issue-1518
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 2 (implementation=1, repair=1)
- Last head SHA: ae78f5b942801b2a845cd2b9e35588ec2c185560
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ856wH2h
- Repeated failure signature count: 1
- Updated at: 2026-04-14T08:31:52.003Z

## Latest Codex Summary
Adjusted the default tracked-PR reconciliation slice so mixed-state passes stop after the recoverable tracked PR records instead of spending the remaining default budget on historical `done` records. The behavior change is in [src/recovery-tracked-pr-reconciliation.ts](src/recovery-tracked-pr-reconciliation.ts), and I added a direct regression in [src/recovery-tracked-pr-reconciliation.test.ts](src/recovery-tracked-pr-reconciliation.test.ts) plus tightened the prelude coverage in [src/run-once-cycle-prelude.test.ts](src/run-once-cycle-prelude.test.ts). The issue journal was updated before closing the turn.

Focused verification passed:
- `npx tsx --test src/recovery-tracked-pr-reconciliation.test.ts src/run-once-cycle-prelude.test.ts`
- `npm run build`

Checkpoint commit: `ae78f5b` (`Prevent tracked PR reconciliation from spending budget on done history`)

Summary: Default tracked-PR reconciliation now spends its first-cycle budget only on recoverable tracked PR records in mixed states; focused regressions and build passed.
State hint: stabilizing
Blocked reason: none
Tests: `npx tsx --test src/recovery-tracked-pr-reconciliation.test.ts src/run-once-cycle-prelude.test.ts`; `npm run build`
Next action: Open or update the branch PR so this checkpoint can move into review/CI.
Failure signature: PRRT_kwDORgvdZ856wH2h

## Active Failure Context
- Category: review
- Summary: 1 unresolved automated review thread(s) remain.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/1519#discussion_r3078122159
- Details:
  - src/recovery-tracked-pr-reconciliation.ts:122 summary=_⚠️ Potential issue_ | _🟠 Major_ **Preserve the historical `done` cursor when you defer that bucket.** After this change, `records.length` in Lines 413-418 can mean “the recove... url=https://github.com/TommyKammy/codex-supervisor/pull/1519#discussion_r3078122159

## Codex Working Notes
### Current Handoff
- Hypothesis: The review finding was valid: after the mixed-state prioritization change, a pass that exhausted only the recoverable bucket could still clear `tracked_merged_but_open_last_processed_issue_number`, which discarded historical `done` resume progress.
- What changed: Updated `prioritizeTrackedMergedButOpenRecords(...)` in `src/recovery-tracked-pr-reconciliation.ts` to return whether historical `done` records were deferred, and changed the end-of-pass cursor update to preserve the existing historical cursor when that deferred bucket remains. Added a direct regression in `src/recovery-tracked-pr-reconciliation.test.ts` that seeds a historical cursor and proves the mixed-state pass keeps it while still only looking up recoverable tracked PRs.
- Current blocker: none
- Next exact step: Commit and push the review-fix checkpoint on `codex/issue-1518` so PR #1519 picks up the preserved historical-cursor behavior.
- Verification gap: Focused regressions and TypeScript build passed; no broader full-suite run yet.
- Files touched: .codex-supervisor/issue-journal.md; src/recovery-tracked-pr-reconciliation.ts; src/recovery-tracked-pr-reconciliation.test.ts
- Rollback concern: Low; the behavior change is limited to mixed-state tracked-PR cursor handling and only preserves the existing historical `done` resume position when that bucket is intentionally deferred.
- Last focused command: npm run build
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
