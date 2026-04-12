# Issue #1456: Surface preserved partial-work incidents in status and explain

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1456
- Branch: codex/issue-1456
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 3 (implementation=2, repair=1)
- Last head SHA: f91771159ce7d0b836be9f76c0654bc32fd66ea1
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ856WcaU|PRRT_kwDORgvdZ856WcaV
- Repeated failure signature count: 1
- Updated at: 2026-04-12T07:55:32Z

## Latest Codex Summary
Verified with `gh pr view` and thread-aware review reads that PR #1459 is clean and green, and that the only unresolved review feedback is two CodeRabbit comments against this journal checkpoint. The underlying preserved-partial-work implementation is unchanged this turn; this refresh only realigns the tracked handoff with the live review state.

I did not rerun local verification for this metadata-only repair. The relevant prior verification remains the focused `npx tsx --test src/core/git-workspace-helpers.test.ts src/recovery-support.test.ts src/supervisor/supervisor-diagnostics-explain.test.ts src/supervisor/supervisor-selection-issue-explain.test.ts src/supervisor/supervisor-status-rendering.test.ts` run plus `npm run build`. The next step is to push this journal refresh so GitHub can re-evaluate the remaining review threads against a self-consistent checkpoint.

Summary: Refreshed the issue journal so the remaining PR #1459 blocker is represented consistently while the two journal-metadata review threads are still open
State hint: addressing_review
Blocked reason: none
Tests: Not rerun this turn; metadata-only journal repair, relying on the prior focused `npx tsx --test src/core/git-workspace-helpers.test.ts src/recovery-support.test.ts src/supervisor/supervisor-diagnostics-explain.test.ts src/supervisor/supervisor-selection-issue-explain.test.ts src/supervisor/supervisor-status-rendering.test.ts` run and `npm run build`
Next action: Commit and push this journal refresh to PR #1459, then recheck review-thread state and CI
Failure signature: PRRT_kwDORgvdZ856WcaU|PRRT_kwDORgvdZ856WcaV

## Active Failure Context
- Category: review
- Summary: 2 unresolved automated review thread(s) remain.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/1459#discussion_r3069148325
- Details:
  - .codex-supervisor/issue-journal.md:9 summary=_⚠️ Potential issue_ | _🟡 Minor_ **Fix attempt-count arithmetic consistency** Line 9 reports `Attempt count: 4` but the breakdown shown is `implementation=2, repair=1` (total 3). url=https://github.com/TommyKammy/codex-supervisor/pull/1459#discussion_r3069148325
  - .codex-supervisor/issue-journal.md:29 summary=_⚠️ Potential issue_ | _🟡 Minor_ **Unify failure-signature state across sections** Line 12 keeps a concrete failure signature, while Line 26 says `Failure signature: none` and ... url=https://github.com/TommyKammy/codex-supervisor/pull/1459#discussion_r3069148326

## Codex Working Notes
### Current Handoff
- Hypothesis: The preserved-partial-work implementation is already complete; the remaining review work is limited to making this tracked checkpoint internally consistent so the outstanding journal-only PR threads can clear.
- What changed: Re-read the issue journal, verified the current PR and review-thread state with `gh` plus the GraphQL comment fetcher, confirmed the attempt counter drift was in the tracked checkpoint rather than the implementation/runtime code, and refreshed the journal so the snapshot, summary footer, and active failure context all describe the same active review blocker.
- Current blocker: Two unresolved journal-metadata review threads on PR #1459 remain until this refreshed checkpoint is pushed.
- Next exact step: Commit and push the refreshed `.codex-supervisor/issue-journal.md`, then re-read PR #1459 to see whether the review threads are cleared or only become outdated.
- Verification gap: No additional code verification reran for this metadata-only journal repair; the latest implementation verification remains the focused `npx tsx --test src/core/git-workspace-helpers.test.ts src/recovery-support.test.ts src/supervisor/supervisor-diagnostics-explain.test.ts src/supervisor/supervisor-selection-issue-explain.test.ts src/supervisor/supervisor-status-rendering.test.ts` run plus `npm run build`.
- Files touched: .codex-supervisor/issue-journal.md
- Rollback concern: Low; this turn only refreshes tracked supervisor handoff metadata and does not alter the implemented preserved-partial-work behavior.
- Last focused command: `python3 /Users/tomoakikawada/.codex/plugins/cache/openai-curated/github/fb0a18376bcd9f2604047fbe7459ec5aed70c64b/skills/gh-address-comments/scripts/fetch_comments.py > /tmp/issue1456-pr1459-comments.json`
- Last focused commands: `gh auth status`; `gh pr view 1459 --json number,url,headRefOid,reviewDecision,mergeStateStatus,statusCheckRollup`; `python3 /Users/tomoakikawada/.codex/plugins/cache/openai-curated/github/fb0a18376bcd9f2604047fbe7459ec5aed70c64b/skills/gh-address-comments/scripts/fetch_comments.py > /tmp/issue1456-pr1459-comments.json`
### Scratchpad
- 2026-04-12: Verified the two remaining unresolved PR threads are both journal-only comments on `.codex-supervisor/issue-journal.md`; no runtime code path was identified that would have produced the stale snapshot now in the branch.
- 2026-04-12: Pushed journal-only follow-up commit `f917711`; PR #1459 now shows fresh pending CI/check runs on the refreshed checkpoint.
- 2026-04-12: Confirmed the only remaining unresolved review thread was the stale journal checkpoint itself; refreshed the tracked metadata to `pr_open` after verifying PR #1459 is clean and green.
- 2026-04-12: Addressed PRRT_kwDORgvdZ856WZIX by excluding `??` entries from failed no-PR `preservedTrackedFiles`; untracked-only work still yields `manual_review_required` but no longer advertises preserved tracked partial work.
- 2026-04-12: Posted follow-up on PR #1459 via `gh api` because the GitHub app lacked permission to reply to the inline comment, then resolved the review thread directly with GraphQL.
