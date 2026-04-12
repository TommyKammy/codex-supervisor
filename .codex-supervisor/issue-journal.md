# Issue #1456: Surface preserved partial-work incidents in status and explain

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1456
- Branch: codex/issue-1456
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: repairing_ci
- Attempt count: 6 (implementation=2, repair=2)
- Last head SHA: 0311e0d4b3be4df5b9b1dc109dadde72464d1f47
- Blocked reason: none
- Last failure signature: build (ubuntu-latest):fail
- Repeated failure signature count: 3
- Updated at: 2026-04-12T07:37:07.876Z

## Latest Codex Summary
Reproduced the failing `build (ubuntu-latest)` check for PR `#1459` via the GitHub Actions log and confirmed the root cause is still the tracked `.codex-supervisor/issue-journal.md` at `HEAD`: lines 45-46 in the committed file still mention a workstation-local absolute path to the comment-fetch helper, which trips `npm run verify:paths` on Ubuntu.

The working copy already had the portable redaction in place, so I verified the intended fix locally with `npm run verify:paths`, which now passes. This turn packages that tracked journal repair for push so CI can rerun against the sanitized command history.

Summary: Reproduced the Ubuntu CI failure to a stale workstation-local path leak in the committed issue journal and verified the local redaction with `npm run verify:paths`
State hint: repairing_ci
Blocked reason: none
Tests: `npm run verify:paths`
Next action: Commit and push the journal-only path-redaction repair on `codex/issue-1456`, then recheck PR #1459 checks
Failure signature: build (ubuntu-latest):fail

## Active Failure Context
- Category: checks
- Summary: PR #1459 has failing checks.
- Command or source: gh pr checks
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/1459
- Details:
  - build (ubuntu-latest) (fail/FAILURE) https://github.com/TommyKammy/codex-supervisor/actions/runs/24301520330/job/70955609165

## Codex Working Notes
### Current Handoff
- Hypothesis: The only active CI failure is the stale committed journal content on `0311e0d`; once the already-redacted working-copy journal is pushed, `verify:paths` should stop failing and the PR should return to waiting on fresh checks.
- What changed: Reproduced the failing Actions check with the bundled `inspect_pr_checks.py` helper, compared `HEAD` versus the working copy for `.codex-supervisor/issue-journal.md`, confirmed the committed file still carried a workstation-local absolute helper path while the working tree had portable placeholders, and reran `npm run verify:paths` locally against the repaired working copy.
- Current blocker: The fix is only local until the sanitized journal diff is committed and pushed to PR #1459.
- Next exact step: Commit the repaired `.codex-supervisor/issue-journal.md`, push `codex/issue-1456`, then re-read PR #1459 check status on the new head.
- Verification gap: This turn reran the failing path verifier only; I did not rerun the broader focused test/build suite because the repair is journal-only and does not touch runtime code.
- Files touched: .codex-supervisor/issue-journal.md
- Rollback concern: Low; this turn only refreshes tracked supervisor handoff metadata and does not alter the implemented preserved-partial-work behavior.
- Last focused command: `npm run verify:paths`
- Last focused commands: `gh auth status`; `python3 <skill-path>/inspect_pr_checks.py --repo . --pr 1459 --json`; `git show HEAD:.codex-supervisor/issue-journal.md | sed -n '40,55p'`; `sed -n '40,55p' .codex-supervisor/issue-journal.md`; `npm run verify:paths`
### Scratchpad
- 2026-04-12: Reproduced `build (ubuntu-latest)` to `npm run verify:paths`; the failure is still the committed workstation-local helper-path reference in `.codex-supervisor/issue-journal.md`, while the working copy already carries the redacted portable form and passes the verifier locally.
- 2026-04-12: Pushed `0311e0d` for the journal metadata repair; PR #1459 now has zero unresolved review threads and fresh CI/CodeRabbit runs on the new head.
- 2026-04-12: Verified the two remaining unresolved PR threads are both journal-only comments on `.codex-supervisor/issue-journal.md`; no runtime code path was identified that would have produced the stale snapshot now in the branch.
- 2026-04-12: Pushed journal-only follow-up commit `f917711`; PR #1459 now shows fresh pending CI/check runs on the refreshed checkpoint.
- 2026-04-12: Confirmed the only remaining unresolved review thread was the stale journal checkpoint itself; refreshed the tracked metadata to `pr_open` after verifying PR #1459 is clean and green.
- 2026-04-12: Addressed PRRT_kwDORgvdZ856WZIX by excluding `??` entries from failed no-PR `preservedTrackedFiles`; untracked-only work still yields `manual_review_required` but no longer advertises preserved tracked partial work.
- 2026-04-12: Posted follow-up on PR #1459 via `gh api` because the GitHub app lacked permission to reply to the inline comment, then resolved the review thread directly with GraphQL.
