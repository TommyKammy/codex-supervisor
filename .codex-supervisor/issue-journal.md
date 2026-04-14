# Issue #1520: Bug: run-once prelude revalidates historical closed issues via merged_issue_closures on every cycle

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1520
- Branch: codex/issue-1520
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 2 (implementation=1, repair=1)
- Last head SHA: 717f492d1e7c713107e522573ab130135b57892f
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ856w4vK|PRRT_kwDORgvdZ856w4vO
- Repeated failure signature count: 1
- Updated at: 2026-04-14T09:19:30.705Z

## Latest Codex Summary
Implemented a narrow fix in [src/recovery-reconciliation.ts](src/recovery-reconciliation.ts) so `reconcileMergedIssueClosures()` no longer scans historical closed terminal records every cycle. It now revalidates only when the closed issue is still active locally, not yet terminal locally, or GitHub’s `updatedAt` is newer than the local terminal timestamps. That preserves convergence for suspicious/recently changed closures without paying O(history) GraphQL cost on old `done` backlogs.

I added focused regressions in [src/supervisor/supervisor-recovery-reconciliation.test.ts](src/supervisor/supervisor-recovery-reconciliation.test.ts) and [src/run-once-cycle-prelude.test.ts](src/run-once-cycle-prelude.test.ts) that prove a `160`-record historical closed backlog no longer causes `160` merged-closure lookups, while recently changed and non-terminal closed records still revalidate. I also updated the issue journal and committed the checkpoint as `717f492` with message `Bound merged issue closure revalidation`.

Summary: Bounded `merged_issue_closures` revalidation to active, non-terminal, or newly changed closed issues; added direct and prelude regression tests; build passed; committed as `717f492`.
State hint: draft_pr
Blocked reason: none
Tests: `npx tsx --test src/supervisor/supervisor-recovery-reconciliation.test.ts src/run-once-cycle-prelude.test.ts`; `npm run build`
Next action: Open or update a draft PR for `codex/issue-1520` with commit `717f492` and let CI validate the bounded merged-closure behavior
Failure signature: PRRT_kwDORgvdZ856w4vK|PRRT_kwDORgvdZ856w4vO

## Active Failure Context
- Category: review
- Summary: 2 unresolved automated review thread(s) remain.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/1521#discussion_r3078391599
- Details:
  - .codex-supervisor/issue-journal.md:29 summary=_⚠️ Potential issue_ | _🟡 Minor_ **Minor wording polish on verification note.** Line 29 reads more cleanly as “locally focused tests” (or “local-focused tests”). url=https://github.com/TommyKammy/codex-supervisor/pull/1521#discussion_r3078391599
  - src/recovery-reconciliation.ts:366 summary=_⚠️ Potential issue_ | _🟠 Major_ **Keep provenance-free `done` records eligible for merged-closure backfill.** Once a record reaches `done`, this gate treats it as converged ba... url=https://github.com/TommyKammy/codex-supervisor/pull/1521#discussion_r3078391603

## Codex Working Notes
### Current Handoff
- Hypothesis: The review-thread regression was real because the new timestamp-only gate could treat a provenance-free `done` record as converged forever, preventing `merged_issue_closures` from backfilling merged PR provenance for suspicious closed issues.
- What changed: Tightened `shouldRevalidateMergedIssueClosureRecord()` in `src/recovery-reconciliation.ts` so `done` records still revalidate when `pr_number` or `last_head_sha` is missing, even if GitHub has not updated since the local terminal timestamp. Extended the direct reconciliation and `runOnceCyclePrelude` backlog tests to prove provenance-free `done` records still trigger bounded merged-closure lookups. Updated the verification note wording to "locally focused tests".
- Current blocker: none
- Next exact step: Commit the review-thread fix on `codex/issue-1520`, push the branch, and update PR #1521 so the unresolved automated review threads can be re-evaluated on the new head.
- Verification gap: No PR/CI verification yet on the review-fix head; locally focused tests and `npm run build` passed.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/recovery-reconciliation.ts`, `src/supervisor/supervisor-recovery-reconciliation.test.ts`, `src/run-once-cycle-prelude.test.ts`
- Rollback concern: Low. The change only widens revalidation for suspicious closed `done` records that are missing merged-closure provenance; historical terminal records with intact provenance remain bounded by the timestamp gate.
- Last focused command: `npm run build`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
