# Issue #1619: Narrow loop-off tracked-work blockers to loop-advanceable states

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1619
- Branch: codex/issue-1619
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 2 (implementation=1, repair=1)
- Last head SHA: 77fda093dc21b6e75e8a1b3e8f8ffc5adedf7d3b
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ858hx8x
- Repeated failure signature count: 1
- Updated at: 2026-04-21T14:29:21.059Z

## Latest Codex Summary
Narrowed the loop-off blocker so only loop-advanceable tracked states trigger the restart-the-loop message. The shared selector now excludes `blocked` and `failed`, and the dashboard/browser logic matches that policy. I also tightened the focused regressions so blocked-only tracked sets stay visible without claiming the loop can resume them, while mixed tracked sets still point at the first advanceable issue. Checkpoint commit: `77fda09` (`Narrow loop-off tracked-work blockers`).

Verification passed with `npx tsx --test src/supervisor/supervisor-diagnostics-status-selection.test.ts src/supervisor/supervisor-diagnostics-explain.test.ts src/backend/webui-dashboard.test.ts src/backend/webui-dashboard-browser-logic.test.ts` and `npm run build`. The worktree still has untracked supervisor runtime artifacts under `.codex-supervisor/` that I left untouched.

Summary: Narrowed loop-off tracked-work blockers to loop-advanceable states, added blocked-only/mixed-state regressions across status, explain, and WebUI, and committed the checkpoint.
State hint: draft_pr
Blocked reason: none
Tests: `npx tsx --test src/supervisor/supervisor-diagnostics-status-selection.test.ts src/supervisor/supervisor-diagnostics-explain.test.ts src/backend/webui-dashboard.test.ts src/backend/webui-dashboard-browser-logic.test.ts`; `npm run build`
Next action: Open or update the draft PR from `codex/issue-1619` using commit `77fda09`.
Failure signature: PRRT_kwDORgvdZ858hx8x

## Active Failure Context
- Category: review
- Summary: 1 unresolved automated review thread(s) remain.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/1620#discussion_r3118162345
- Details:
  - src/backend/webui-dashboard-browser-logic.ts:342 summary=_⚠️ Potential issue_ | _🟠 Major_ **Blocked tracked issues are being hidden globally, not just excluded from loop-restart messaging.** This change affects all `collectTrackedIss... url=https://github.com/TommyKammy/codex-supervisor/pull/1620#discussion_r3118162345

## Codex Working Notes
### Current Handoff
- Hypothesis: The CodeRabbit finding was valid on the branch because `collectTrackedIssues()` was filtering out `blocked` and `failed` globally in browser logic; loop-off restart guidance needed its own narrower filter while tracked history and shortcuts kept those entries visible.
- What changed: Restored `collectTrackedIssues()` in `src/backend/webui-dashboard-browser-logic.ts` to hide only `done` by default, narrowed `describeLoopOffTrackedWorkBlocker()` with an inline loop-advanceable filter, and expanded browser/dashboard tests so blocked tracked items stay visible in history/shortcuts while blocked-only loop-off sets do not advertise restart-loop guidance.
- Current blocker: none
- Next exact step: commit the review fix on `codex/issue-1619`, push the branch, and resolve/respond to PR thread `PRRT_kwDORgvdZ858hx8x`.
- Verification gap: none for the requested local bundle; targeted regressions and `npm run build` passed after the browser-script serialization fix.
- Files touched: `.codex-supervisor/issue-journal.md`; `src/backend/webui-dashboard-browser-logic.ts`; `src/backend/webui-dashboard-browser-logic.test.ts`; `src/backend/webui-dashboard.test.ts`
- Rollback concern: The dashboard browser script inlines helper source strings, so future browser-logic changes cannot depend on cross-module helpers unless those helpers are also injected into `src/backend/webui-dashboard-browser-script.ts`.
- Last focused command: `npx tsx --test src/backend/webui-dashboard-browser-logic.test.ts src/backend/webui-dashboard.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts src/supervisor/supervisor-diagnostics-explain.test.ts && npm run build`
### Scratchpad
- Intermediate failure while fixing review thread: dashboard DOM tests initially threw `ReferenceError: import_utils is not defined` because the injected browser script serialized `describeLoopOffTrackedWorkBlocker()` with a cross-module helper reference. Resolved by keeping the restart-only predicate inline inside `webui-dashboard-browser-logic.ts`.
- Keep this section short. The supervisor may compact older notes automatically.
