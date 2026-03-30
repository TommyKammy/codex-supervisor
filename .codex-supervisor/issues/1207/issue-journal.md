# Issue #1207: [codex] Classify local CI gate failures and route remediation guidance

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1207
- Branch: codex/issue-1207
- Workspace: .
- Journal: .codex-supervisor/issues/1207/issue-journal.md
- Current phase: addressing_review
- Attempt count: 3 (implementation=2, repair=1)
- Last head SHA: 0ee55d09045abf75b80968ca71980d46b21557c8
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ853sEX8|PRRT_kwDORgvdZ853sEYB|PRRT_kwDORgvdZ853sEYE
- Repeated failure signature count: 1
- Updated at: 2026-03-30T13:34:16.482Z

## Latest Codex Summary
The existing checkpoint was already coherent; the missing piece was local toolchain setup. I ran `npm ci`, reran the issue-target verification, confirmed `npm run build` now passes, pushed `codex/issue-1207`, and opened draft PR `#1210`: https://github.com/TommyKammy/codex-supervisor/pull/1210

I also updated the issue journal’s working notes and latest summary in [issue-journal.md](.codex-supervisor/issues/1207/issue-journal.md) so the next supervisor pass sees the resolved verification state instead of the stale missing-`tsc` blocker.

Summary: Verified the existing local CI classification checkpoint after installing dev dependencies, pushed `codex/issue-1207`, and opened draft PR #1210.
State hint: draft_pr
Blocked reason: none
Tests: Passed `npm ci`; passed `npx tsx --test src/doctor.test.ts src/backend/webui-dashboard.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts src/local-ci.test.ts`; passed `npm run build`
Next action: wait for review or CI feedback on PR #1210 and address any follow-up if it appears
Failure signature: PRRT_kwDORgvdZ853sEX8|PRRT_kwDORgvdZ853sEYB|PRRT_kwDORgvdZ853sEYE

## Active Failure Context
- Category: review
- Summary: 3 unresolved automated review thread(s) remain.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/1210#discussion_r3009833908
- Details:
  - .codex-supervisor/issues/1207/issue-journal.md:24 summary=_⚠️ Potential issue_ | _🟡 Minor_ **Fix minor wording issues in operator-facing notes.** There are small grammar issues that can reduce clarity: - Line 24: “needed typed classif... url=https://github.com/TommyKammy/codex-supervisor/pull/1210#discussion_r3009833908
  - src/local-ci.ts:42 summary=_⚠️ Potential issue_ | _🟠 Major_ **Narrow `missing_command` detection to the configured entrypoint.** This heuristic currently upgrades any bare `not found` text or `exitCode=1... url=https://github.com/TommyKammy/codex-supervisor/pull/1210#discussion_r3009833913
  - src/supervisor/supervisor-operator-activity-context.ts:87 summary=_⚠️ Potential issue_ | _🟠 Major_ **Keep the legacy local-CI signature blocking during rollout.** Persisted records that were already blocked before this change can still have `... url=https://github.com/TommyKammy/codex-supervisor/pull/1210#discussion_r3009833918

## Codex Working Notes
### Current Handoff
- Hypothesis: local CI gate failures needed to keep their typed operator-facing classification, but `missing_command` detection had to stay scoped to explicit top-level contract failures so nested `127` exits still route operators to the repo-owned command.
- What changed: narrowed `isMissingCommandError` to require explicit configured-command markers on `not found` and `missing script` lines, added regressions for nested missing binaries and top-level missing entrypoints, restored legacy `local-ci-gate-failed` compatibility in operator blocking status, and fixed the minor journal wording flagged in review.
- Current blocker: none.
- Next exact step: commit these review-fix changes, push `codex/issue-1207`, and update PR #1210 for re-review.
- Verification gap: none for the targeted review-fix surface; the focused suite plus `npm run build` passed after the detector narrowing and compatibility fix.
- Files touched: .codex-supervisor/issues/1207/issue-journal.md; src/local-ci.ts; src/local-ci.test.ts; src/supervisor/supervisor-operator-activity-context.ts; src/supervisor/supervisor-operator-activity-context.test.ts
- Rollback concern: low; the classifier is stricter than before, so the main risk is an unforeseen top-level missing-command format that no longer maps to `missing_command` until a new explicit marker is added.
- Last focused command: npm run build
- Commands run this turn: `npx tsx --test src/doctor.test.ts src/backend/webui-dashboard.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts src/local-ci.test.ts src/supervisor/supervisor-operator-activity-context.test.ts`; `npm run build`
- PR status: PR `#1210` remains open at `https://github.com/TommyKammy/codex-supervisor/pull/1210`; local review-fix patch is verified and pending commit/push.
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
