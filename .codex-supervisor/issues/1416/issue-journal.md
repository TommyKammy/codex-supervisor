# Issue #1416: Publish sticky tracked-PR status comments for draft and ready-promotion blockers

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1416
- Branch: codex/issue-1416
- Workspace: .
- Journal: .codex-supervisor/issues/1416/issue-journal.md
- Current phase: repairing_ci
- Attempt count: 4 (implementation=2, repair=2)
- Last head SHA: 48d41ab4228b55e56f0a688148403fb605f4ec07
- Blocked reason: none
- Last failure signature: build (ubuntu-latest):fail
- Repeated failure signature count: 3
- Updated at: 2026-04-11T00:25:15.206Z

## Latest Codex Summary
I inspected the failing Ubuntu Actions run for PR #1420 and confirmed the breakage is a path-hygiene failure in the tracked issue journal, not a feature regression. Commit `48d41ab` recorded an absolute workstation path in the `Tests:` line of [issue-journal.md](.codex-supervisor/issues/1416/issue-journal.md), which caused `npm run verify:paths` to fail on CI before the build reached TypeScript compilation.

I kept the existing local journal sanitization, reran the failing command locally, and verified the branch with the issue's focused test/build commands. Production files under `src/` are unchanged in this repair; the only tracked fix is the journal cleanup needed to unblock CI.

Summary: Reproduced the Ubuntu path-hygiene failure, confirmed the local journal already removed the offending absolute path, and reverified the branch so the sanitized journal can be pushed as the CI repair.
State hint: repairing_ci
Blocked reason: none
Tests: `python3 <gh-fix-ci>/scripts/inspect_pr_checks.py --repo . --pr 1420 --json`; `npm run verify:paths`; `npx tsx --test src/post-turn-pull-request.test.ts src/supervisor/supervisor-status-review-bot.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts`; `npm run build`
Next action: Wait for PR #1420 checks to refresh on the repaired branch head and confirm the Ubuntu build clears.
Failure signature: build (ubuntu-latest):fail

## Active Failure Context
- Category: checks
- Summary: PR #1420 has failing checks.
- Command or source: gh pr checks
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/1420
- Details:
  - build (ubuntu-latest) (fail/FAILURE) https://github.com/TommyKammy/codex-supervisor/actions/runs/24270141826/job/70873310708

## Codex Working Notes
### Current Handoff
- Hypothesis: The only remaining CI blocker is the committed absolute workstation path in the tracked issue journal; once the sanitized journal is pushed, the Ubuntu build should clear.
- What changed: Inspected the failing GitHub Actions run for PR #1420, confirmed `npm run verify:paths` failed on a committed absolute workstation path in the journal's `Tests:` line from commit `48d41ab`, and verified the current working tree already removes that path.
- Current blocker: none
- Next exact step: Push the repaired branch head and recheck PR #1420 checks for a clean Ubuntu build.
- Verification gap: none for the CI repair; the reproduced failing command and the issue verification commands all pass locally on the sanitized journal.
- Files touched: .codex-supervisor/issues/1416/issue-journal.md
- Rollback concern: Existing legacy `kind=host-local-blocker` comments are migrated opportunistically by updating either marker kind in place; removing that compatibility path would strand older sticky comments.
- Last focused command: npm run build
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
