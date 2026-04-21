# Issue #1611: Surface loop-off as an active tracked-work blocker in status and explain

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1611
- Branch: codex/issue-1611
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 2 (implementation=1, repair=1)
- Last head SHA: 925c09f21f3692404f1b7bf983e76920ee1ca195
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ858goN9
- Repeated failure signature count: 1
- Updated at: 2026-04-21T13:30:51.838Z

## Latest Codex Summary
Added a shared loop-off tracked-work blocker across read-only surfaces. Status now emits a structured `loop_runtime_blocker` line plus a `status_warning` when non-done tracked work exists and the loop is off; explain now carries the same blocker; and the WebUI overview/action/attention summaries now treat that state as blocked instead of idle. I also updated the focused tests and made checkpoint commit `925c09f` (`Surface loop-off tracked-work blockers`).

Verification used `npx tsx --test src/supervisor/supervisor-diagnostics-status-selection.test.ts src/supervisor/supervisor-diagnostics-explain.test.ts src/backend/webui-dashboard-browser-logic.test.ts src/backend/webui-dashboard.test.ts` and `npm run build`. I also updated `.codex-supervisor/issue-journal.md`. The only remaining untracked files are supervisor runtime artifacts under `.codex-supervisor/`, not code changes.

Summary: surfaced explicit loop-off blockers for active tracked work in status, explain, and WebUI summaries; added focused regression coverage; committed as `925c09f`
State hint: implementing
Blocked reason: none
Tests: `npx tsx --test src/supervisor/supervisor-diagnostics-status-selection.test.ts src/supervisor/supervisor-diagnostics-explain.test.ts src/backend/webui-dashboard-browser-logic.test.ts src/backend/webui-dashboard.test.ts`; `npm run build`
Next action: open or update the draft PR for `codex/issue-1611` with commit `925c09f`
Failure signature: PRRT_kwDORgvdZ858goN9

## Active Failure Context
- Category: review
- Summary: 1 unresolved automated review thread(s) remain.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/1617#discussion_r3117757427
- Details:
  - src/supervisor/supervisor-read-only-reporting.ts:537 summary=_⚠️ Potential issue_ | _🟠 Major_ **Build the explain blocker from all tracked records, not just the queried record.** `buildLoopOffTrackedWorkBlocker()` is summarizing shared l... url=https://github.com/TommyKammy/codex-supervisor/pull/1617#discussion_r3117757427

## Codex Working Notes
### Current Handoff
- Hypothesis: The remaining review miss was limited to explain-report aggregation: the shared loop-off blocker helper was correct, but `buildSupervisorExplainReport()` still passed only the explained record instead of the full tracked set.
- What changed: Reused `buildTrackedIssueDtos(state)` inside `buildSupervisorExplainReport()` so explain now derives the loop-off blocker from all tracked records, matching status/WebUI behavior. Added a regression test covering an untracked explained issue while two tracked issues are stalled with the loop off.
- Current blocker: none
- Next exact step: Commit and push the review fix on `codex/issue-1611`, then resolve the CodeRabbit thread on PR #1617 if no other review feedback appears.
- Verification gap: none for the review fix; the targeted suite and full build both passed locally.
- Files touched: .codex-supervisor/issue-journal.md; src/supervisor/supervisor-loop-runtime-state.ts; src/supervisor/supervisor-read-only-reporting.ts; src/supervisor/supervisor-selection-issue-explain.ts; src/supervisor/supervisor-diagnostics-status-selection.test.ts; src/supervisor/supervisor-diagnostics-explain.test.ts; src/backend/webui-dashboard-browser-logic.ts; src/backend/webui-dashboard-browser-logic.test.ts; src/backend/webui-dashboard-browser-script.ts; src/backend/webui-dashboard-browser-issue-details.ts; src/backend/webui-dashboard.test.ts
- Rollback concern: Low. The main behavior change is additional loop-off blocker derivation on read-only surfaces when non-done tracked work exists; tests cover status, explain, and WebUI summaries.
- Last focused command: npx tsx --test src/supervisor/supervisor-diagnostics-status-selection.test.ts src/supervisor/supervisor-diagnostics-explain.test.ts src/backend/webui-dashboard-browser-logic.test.ts src/backend/webui-dashboard.test.ts
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
