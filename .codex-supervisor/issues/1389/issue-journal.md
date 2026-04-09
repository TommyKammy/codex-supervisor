# Issue #1389: Refactor: extract dashboard view-model formatting and browser snapshot helpers

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1389
- Branch: codex/issue-1389
- Workspace: .
- Journal: .codex-supervisor/issues/1389/issue-journal.md
- Current phase: addressing_review
- Attempt count: 3 (implementation=2, repair=1)
- Last head SHA: db1a0aa5709a94b0c42902e82f68837e2365baf6
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ855xQbp|PRRT_kwDORgvdZ855xQb0
- Repeated failure signature count: 1
- Updated at: 2026-04-09T16:20:13+09:00

## Latest Codex Summary
Extracted the remaining pure issue-detail formatting slice from [webui-dashboard-browser-script.ts](src/backend/webui-dashboard-browser-script.ts) into [webui-dashboard-browser-issue-details.ts](src/backend/webui-dashboard-browser-issue-details.ts), with focused coverage in [webui-dashboard-browser-issue-details.test.ts](src/backend/webui-dashboard-browser-issue-details.test.ts). The browser script now keeps DOM/event flow local and passes retry/recovery formatters explicitly so the injected helper source stays runtime-self-contained.

Committed as `db1a0aa` (`Extract dashboard browser issue detail helpers`) and opened draft PR #1396: https://github.com/TommyKammy/codex-supervisor/pull/1396. The only remaining untracked files are supervisor runtime artifacts under `.codex-supervisor/`, not code changes.

Summary: Extracted dashboard issue-detail browser helpers into a dedicated module, verified the injected runtime seam, pushed `codex/issue-1389`, and opened draft PR #1396.
State hint: draft_pr
Blocked reason: none
Tests: `npx tsx --test src/backend/webui-dashboard-browser-issue-details.test.ts src/backend/webui-dashboard-browser-view-model.test.ts`; `npx tsx --test src/backend/webui-dashboard.test.ts src/backend/supervisor-http-server.test.ts --test-name-pattern 'dashboard|snapshot|format|render'`; `npm run build`
Next action: Continue stabilizing from PR #1396 or wait for review/CI feedback on the extracted browser-helper checkpoint.
Failure signature: PRRT_kwDORgvdZ855xQbp|PRRT_kwDORgvdZ855xQb0

## Active Failure Context
- Category: review
- Summary: 2 unresolved automated review thread(s) remain.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/1396#discussion_r3056109960
- Details:
  - src/backend/webui-dashboard-browser-issue-details.ts:73 summary=_⚠️ Potential issue_ | _🟡 Minor_ **Potential display of `null`/`undefined` in output string when `latestRecovery` fields are missing.** When `latestRecovery` is truthy but its ... url=https://github.com/TommyKammy/codex-supervisor/pull/1396#discussion_r3056109960
  - src/backend/webui-dashboard-browser-view-model.test.ts:83 summary=_⚠️ Potential issue_ | _🟡 Minor_ **Potential test flakiness due to locale/timezone-dependent comparison.** `toLocaleTimeString()` output varies by system locale and timezone se... url=https://github.com/TommyKammy/codex-supervisor/pull/1396#discussion_r3056109977

## Codex Working Notes
### Current Handoff
- Hypothesis: The remaining review feedback is valid and can be closed with one defensive recovery-formatting guard plus test hardening, without changing dashboard rendering flow or operator-visible time formatting behavior.
- What changed: Hardened `formatLatestRecovery` in `webui-dashboard-browser-issue-details.ts` so incomplete typed recovery DTOs fall back to the legacy summary instead of rendering `null`/`undefined`, added regression coverage for incomplete typed recovery data in `webui-dashboard-browser-issue-details.test.ts`, and loosened `webui-dashboard-browser-view-model.test.ts` so `formatRefreshTime` is only required to return a non-empty string for timestamps instead of matching a locale-dependent exact value.
- Current blocker: none
- Next exact step: Commit the review-fix checkpoint on `codex/issue-1389`, push the branch, and leave the PR ready for thread resolution or re-review.
- Verification gap: None for the review-fix slice; helper tests, dashboard/server rendering tests, and full build passed locally after the changes.
- Files touched: `.codex-supervisor/issues/1389/issue-journal.md`, `src/backend/webui-dashboard-browser-view-model.test.ts`, `src/backend/webui-dashboard-browser-issue-details.ts`, `src/backend/webui-dashboard-browser-issue-details.test.ts`
- Rollback concern: The only behavior change is that incomplete typed recovery DTOs now stop short of rendering broken `null`/`undefined` tokens; if a caller depends on partial typed recovery output instead of the legacy fallback, the latest recovery section would now prefer the fallback or `none`.
- Last focused command: `npm run build`
### Scratchpad
- Reproduced focused failure first with `npx tsx --test src/backend/webui-dashboard-browser-view-model.test.ts` (`MODULE_NOT_FOUND` for the new extraction seam), then implemented the module and reran targeted tests.
- Reproduced two runtime injection failures while extracting issue-detail helpers: first `buildDetailItems is not defined`, then `import_webui_dashboard_browser_logic is not defined`; fixed both by keeping helper internals self-contained and passing imported retry/recovery formatters explicitly at call time.
- Addressed review thread `PRRT_kwDORgvdZ855xQbp` by requiring `issueNumber`, `at`, and `reason` before formatting typed recovery details; otherwise `formatLatestRecovery` now falls back to `latestRecoverySummary` or `"none"`.
- Addressed review thread `PRRT_kwDORgvdZ855xQb0` by replacing the exact `toLocaleTimeString()` equality check with assertions that `formatRefreshTime()` returns a non-empty non-`"never"` string for a real timestamp.
- Commands run after the review fix: `npx tsx --test src/backend/webui-dashboard-browser-issue-details.test.ts src/backend/webui-dashboard-browser-view-model.test.ts`; `npx tsx --test src/backend/webui-dashboard.test.ts src/backend/supervisor-http-server.test.ts --test-name-pattern 'dashboard|snapshot|format|render'`; `npm run build`
