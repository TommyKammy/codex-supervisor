# Issue #1389: Refactor: extract dashboard view-model formatting and browser snapshot helpers

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1389
- Branch: codex/issue-1389
- Workspace: .
- Journal: .codex-supervisor/issues/1389/issue-journal.md
- Current phase: addressing_review
- Attempt count: 4 (implementation=2, repair=2)
- Last head SHA: 93355d1e71acf3e748465e04bb4d0325717aec86
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ855xaMp
- Repeated failure signature count: 1
- Updated at: 2026-04-09T07:29:37.243Z

## Latest Codex Summary
Updated PR #1396 on `codex/issue-1389` with commit `93355d1`. In [webui-dashboard-browser-issue-details.ts](src/backend/webui-dashboard-browser-issue-details.ts#L58) `formatLatestRecovery` now only formats typed recovery data when `issueNumber`, `at`, and `reason` are all present; otherwise it falls back to the legacy summary or `"none"` so the dashboard no longer renders `null` or `undefined`. I added regression coverage in [webui-dashboard-browser-issue-details.test.ts](src/backend/webui-dashboard-browser-issue-details.test.ts#L45) and replaced the locale-dependent exact clock assertion in [webui-dashboard-browser-view-model.test.ts](src/backend/webui-dashboard-browser-view-model.test.ts#L77) with a non-empty string check.

Verification passed: `npx tsx --test src/backend/webui-dashboard-browser-issue-details.test.ts src/backend/webui-dashboard-browser-view-model.test.ts`; `npx tsx --test src/backend/webui-dashboard.test.ts src/backend/supervisor-http-server.test.ts --test-name-pattern 'dashboard|snapshot|format|render'`; `npm run build`. The branch is pushed; the only remaining worktree changes are untracked supervisor runtime artifacts under `.codex-supervisor/`.

Summary: Addressed the two unresolved dashboard review threads, updated the issue journal, and pushed commit `93355d1` to PR #1396
State hint: addressing_review
Blocked reason: none
Tests: `npx tsx --test src/backend/webui-dashboard-browser-issue-details.test.ts src/backend/webui-dashboard-browser-view-model.test.ts`; `npx tsx --test src/backend/webui-dashboard.test.ts src/backend/supervisor-http-server.test.ts --test-name-pattern 'dashboard|snapshot|format|render'`; `npm run build`
Next action: Re-check PR #1396 for remaining unresolved review threads and resolve or respond if no further code changes are needed
Failure signature: PRRT_kwDORgvdZ855xaMp

## Active Failure Context
- Category: review
- Summary: 1 unresolved automated review thread(s) remain.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/1396
- Details:
  - src/backend/webui-dashboard-browser-view-model.test.ts summary=Only one unresolved review thread remains after push, and `gh` reports it as `isOutdated: true`; the locale/time assertion fix is already on the branch, so the remaining action is manual thread resolution or re-review. url=https://github.com/TommyKammy/codex-supervisor/pull/1396

## Codex Working Notes
### Current Handoff
- Hypothesis: All actionable automated review feedback is now implemented on `codex/issue-1389`; the only remaining unresolved thread is an outdated CodeRabbit note whose underlying test fix is already present on the branch.
- What changed: Normalized `formatReviewWaits` in `webui-dashboard-browser-issue-details.ts` so missing review-wait fields consistently render as `"none"` including the `undefined` case for `configuredWaitSeconds`, added regression coverage in `webui-dashboard-browser-issue-details.test.ts` for a review-wait entry with nullish values across every optional field, committed the slice as `bac7bd1`, and pushed it to PR #1396.
- Current blocker: manual review thread resolution/re-review only
- Next exact step: Leave PR #1396 for manual thread resolution or re-review, since the remaining unresolved thread is outdated and no additional local code change is indicated by the live PR data.
- Verification gap: None for this review-fix slice; focused helper tests, dashboard/server rendering tests, and the full build all passed locally after the change.
- Files touched: `.codex-supervisor/issues/1389/issue-journal.md`, `src/backend/webui-dashboard-browser-issue-details.ts`, `src/backend/webui-dashboard-browser-issue-details.test.ts`
- Rollback concern: The only behavior change is that incomplete review-wait DTOs now render stable `"none"` placeholders instead of leaking `undefined` or `null`; if an operator depended on those broken tokens for debugging, that output is now sanitized.
- Last focused command: `python3 /home/tommy/.codex/plugins/cache/openai-curated/github/b4940fd0a222022ecd7852e20a4c89ed36b9e9de/skills/gh-address-comments/scripts/fetch_comments.py | jq '.review_threads[] | select(.isResolved == false) | {id, path, line, isOutdated, comments: [.comments.nodes[] | {author: .author.login, body: .body}]}'`
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
