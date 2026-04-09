# Issue #1389: Refactor: extract dashboard view-model formatting and browser snapshot helpers

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1389
- Branch: codex/issue-1389
- Workspace: .
- Journal: .codex-supervisor/issues/1389/issue-journal.md
- Current phase: repairing_ci
- Attempt count: 5 (implementation=2, repair=3)
- Last head SHA: 211e1ef61b72fdd1f0d6e00459a45f56330db7be
- Blocked reason: none
- Last failure signature: build (ubuntu-latest):fail
- Repeated failure signature count: 3
- Updated at: 2026-04-09T07:37:12.015Z

## Latest Codex Summary
Identified the failing Ubuntu CI job on PR #1396 as `npm run verify:paths` rejecting a workstation-local absolute path in the committed issue journal. The working tree already contained the safe redaction in [issue-journal.md](.codex-supervisor/issues/1389/issue-journal.md), so this repair keeps that tracked fix and updates the handoff to reflect the real blocker.

Verification passed with `npm run verify:paths` and `npm run build`. The remaining local leftovers are untracked supervisor runtime artifacts under `.codex-supervisor/`.

Summary: Reproduced the Ubuntu CI failure as a journal path-leak, confirmed the existing redaction fixes `verify:paths`, and refreshed the handoff for a branch update.
State hint: repairing_ci
Blocked reason: none
Tests: `npm run verify:paths`; `npm run build`
Next action: Commit the redacted issue-journal repair, push `codex/issue-1389`, and wait for PR #1396 checks to rerun.
Failure signature: build (ubuntu-latest):fail

## Active Failure Context
- Category: checks
- Summary: PR #1396 has failing checks.
- Command or source: gh pr checks
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/1396
- Details:
  - build (ubuntu-latest) (fail/FAILURE) https://github.com/TommyKammy/codex-supervisor/actions/runs/24178318187/job/70564790486

## Codex Working Notes
### Current Handoff
- Hypothesis: The only actionable blocker was the committed issue-journal path leak; once the redacted journal is pushed, the Ubuntu `verify:paths` check should align with local results and clear.
- What changed: Preserved the redaction in `.codex-supervisor/issues/1389/issue-journal.md` that replaces the leaked workstation-local script path with `<redacted-local-path>` and updated the journal handoff to describe the CI repair instead of the stale manual-review status.
- Current blocker: none locally; remote PR still shows the old failing Ubuntu run until the branch is updated.
- Next exact step: Commit the journal-only CI repair, push `codex/issue-1389`, and watch PR #1396 for a fresh Ubuntu run.
- Verification gap: None for this repair slice; the Linux-specific path gate and the normal build both pass locally.
- Files touched: `.codex-supervisor/issues/1389/issue-journal.md`
- Rollback concern: Minimal; the behavioral change is limited to durable journal text and removes an unsafe local absolute path from tracked state.
- Last focused command: `gh run view 24178318187 --log`
### Scratchpad
- Reproduced focused failure first with `npx tsx --test src/backend/webui-dashboard-browser-view-model.test.ts` (`MODULE_NOT_FOUND` for the new extraction seam), then implemented the module and reran targeted tests.
- Reproduced two runtime injection failures while extracting issue-detail helpers: first `buildDetailItems is not defined`, then `import_webui_dashboard_browser_logic is not defined`; fixed both by keeping helper internals self-contained and passing imported retry/recovery formatters explicitly at call time.
- Addressed review thread `PRRT_kwDORgvdZ855xQbp` by requiring `issueNumber`, `at`, and `reason` before formatting typed recovery details; otherwise `formatLatestRecovery` now falls back to `latestRecoverySummary` or `"none"`.
- Addressed review thread `PRRT_kwDORgvdZ855xQb0` by replacing the exact `toLocaleTimeString()` equality check with assertions that `formatRefreshTime()` returns a non-empty non-`"never"` string for a real timestamp.
- Commands run after the review fix: `npx tsx --test src/backend/webui-dashboard-browser-issue-details.test.ts src/backend/webui-dashboard-browser-view-model.test.ts`; `npx tsx --test src/backend/webui-dashboard.test.ts src/backend/supervisor-http-server.test.ts --test-name-pattern 'dashboard|snapshot|format|render'`; `npm run build`
- Verified the remaining CodeRabbit thread `PRRT_kwDORgvdZ855xaMp` against the live branch and confirmed `formatReviewWaits()` still concatenated nullable fields directly before this turn's fix.
- Addressed review thread `PRRT_kwDORgvdZ855xaMp` by normalizing every nullable review-wait field, including `configuredWaitSeconds === undefined`, to `"none"` before string assembly in `formatReviewWaits()`.
- Added a regression test that covers a review-wait object whose optional fields are all `null`/`undefined` and asserts the rendered summary is stable and operator-safe.
- Commands run for this review-fix slice: `gh auth status`; `npx tsx --test src/backend/webui-dashboard-browser-issue-details.test.ts src/backend/webui-dashboard-browser-view-model.test.ts`; `npx tsx --test src/backend/webui-dashboard.test.ts src/backend/supervisor-http-server.test.ts --test-name-pattern 'dashboard|snapshot|format|render'`; `npm run build`
- Committed the review-wait normalization as `bac7bd1` (`Normalize dashboard review wait formatting`) and pushed `codex/issue-1389` to update PR #1396.
- Live PR thread fetch after the push shows only one unresolved thread remains, `PRRT_kwDORgvdZ855xQb0`, and GitHub reports it as `isOutdated: true`; no unresolved live thread remains for the just-fixed review-wait helper.
- Reproduced the current CI failure with `gh pr checks 1396` and `gh run view 24178318187 --log`; the Ubuntu job fails in `npm run verify:paths` because the committed journal still contained a workstation-local absolute path, while the working tree already had the redacted placeholder.
- Confirmed the repair locally with `npm run verify:paths` and `npm run build` after keeping the redacted journal entry.
