# Issue #850: WebUI drag polish: add accessibility, drop feedback, and browser confidence coverage

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/850
- Branch: codex/issue-850
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 3 (implementation=2, repair=1)
- Last head SHA: aa842bda0ab656c3f075ad4369a35c3ce9a6ca2d
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ852Afsi|PRRT_kwDORgvdZ852Afsj|PRRT_kwDORgvdZ852Afsl|PRRT_kwDORgvdZ852Afsm
- Repeated failure signature count: 1
- Updated at: 2026-03-22T23:56:46.820Z

## Latest Codex Summary
Pushed `codex/issue-850`, opened draft PR [#865](https://github.com/TommyKammy/codex-supervisor/pull/865), and updated the journal handoff to reflect the live PR state. I also cleaned the journal’s malformed latest-summary section and committed those metadata-only updates as `aa842bd`.

PR `#865` is now draft and currently `UNSTABLE` only because checks are still queued: `build (ubuntu-latest)`, `build (macos-latest)`, and `CodeRabbit` are pending. The worktree is otherwise clean except for the existing untracked `.codex-supervisor/replay/` directory.

Summary: Pushed the verified checkpoint, opened draft PR `#865`, and updated the durable journal handoff with the live CI/PR state.
State hint: waiting_ci
Blocked reason: none
Tests: not rerun this turn; no code changes beyond journal/PR metadata updates
Failure signature: none
Next action: monitor PR `#865` CI and review feedback, then address any failures or comments

## Active Failure Context
- Category: review
- Summary: 4 unresolved automated review thread(s) remain.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/865#discussion_r2972305368
- Details:
  - src/backend/webui-dashboard-browser-script.ts:290 _⚠️ Potential issue_ | _🔴 Critical_ **ArrowDown is targeting the wrong slot.** `applyDashboardPanelDrop()` inserts *before* the target panel, but this helper returns the immediate next peer on the first `ArrowDown`. That makes the first downward move a no-op for middle items, and near the end of the list it can even move the panel the wrong way. This needs to track a keyboard insertion slot (or translate `ArrowDown` to the panel *after* the desired slot) so one press really means “move down one”. The current coverage only exercises the `ArrowUp` path, so this regression still goes green. <details> <summary>🤖 Prompt for AI Agents</summary> ``` Verify each finding against the current code and only fix it if needed. In `@src/backend/webui-dashboard-browser-script.ts` around lines 263 - 290, moveKeyboardDropTarget currently returns the immediate next peer for ArrowDown but applyDashboardPanelDrop inserts before the target, so the first ArrowDown becomes a no-op or wrong move; update moveKeyboardDropTarget to compute an insertion slot rather than the peer to land on: for direction > 0, find the next peer (using normalizedOrder and draggedIndex) then return the candidate that corresponds to inserting before the panel after that peer (i.e., translate ArrowDown to the next insertion slot / candidate index, falling back to the last candidate if at the end); keep using getKeyboardDropCandidates, state.dropTargetPanelId, normalizeDashboardPanelOrder, DASHBOARD_PANEL_IDS and DASHBOARD_PANEL_SECTIONS to locate peers and map to the correct candidate, and add tests exercising ArrowDown to ensure the new behavior. ``` </details> <!-- fingerprinting:phantom:medusa:grasshopper --> <!-- This is an auto-generated comment by CodeRabbit -->
  - src/backend/webui-dashboard-browser-script.ts:999 _⚠️ Potential issue_ | _🟡 Minor_ **Clear any existing drag state before starting a pointer drag.** If a panel was already picked up via keyboard and the user starts dragging a different handle with the mouse, `state.draggedPanelId` is overwritten before the old panel is cleaned up. The original panel can stay stuck in `drag-active` until a rerender. <details> <summary>🧹 Suggested fix</summary> ```diff dragHandle.addEventListener("dragstart", (event) => { + clearDragState(); state.draggedPanelId = panelId; panel.classList.add("drag-active"); - setDropTargetPanel(null); announcePanelReorderStatus("Dragging " + panelId.replace(/-/g, " ") + " panel."); if (event.dataTransfer) { ``` </details> <details> <summary>🤖 Prompt for AI Agents</summary> ``` Verify each finding against the current code and only fix it if needed. In `@src/backend/webui-dashboard-browser-script.ts` around lines 995 - 999, Before assigning a new pointer drag, clear any existing drag state: if state.draggedPanelId is set, find the previous panel element (by that id), remove its "drag-active" class and call setDropTargetPanel(null) (and optionally announce or reset any related state) before overwriting state.draggedPanelId; then proceed to set state.draggedPanelId = panelId, add "drag-active" to the current panel, call setDropTargetPanel(null), and announcePanelReorderStatus. This ensures the old panel is cleaned up when dragHandle.addEventListener("dragstart") starts a new drag. ``` </details> <!-- fingerprinting:phantom:medusa:grasshopper --> <!-- This is an auto-generated comment by CodeRabbit -->
  - src/backend/webui-dashboard-browser-script.ts:1009 _⚠️ Potential issue_ | _🟠 Major_ **Don't clobber the specific drop result in `dragend`.** `dragend` fires after `drop`, so this unconditional `"Panel reorder finished."` replaces the more useful success/cancel message from `commitPanelDrop()` and the invalid-drop path. On pointer reorders, the live region can end up with only the generic text, which undercuts the new explicit feedback. <details> <summary>🤖 Prompt for AI Agents</summary> ``` Verify each finding against the current code and only fix it if needed. In `@src/backend/webui-dashboard-browser-script.ts` around lines 1006 - 1009, The dragend handler unconditionally calls announcePanelReorderStatus("Panel reorder finished."), which clobbers the more specific success/cancel messages set by commitPanelDrop() or the invalid-drop path; change the behavior so dragend only calls announcePanelReorderStatus when no more specific announcement was already set — e.g., remove the unconditional announce from the dragend listener and rely on commitPanelDrop()/the invalid-drop code to announce the final status, or make dragend check a shared flag/lastAnnouncement (set by commitPanelDrop()/invalid-drop) and only announce the generic "Panel reorder finished." if that flag is empty. Ensure clearDragState() still runs in dragend and reference the drag handler code around dragHandle.addEventListener("dragend"), the clearDragState() call, and the announcePanelReorderStatus and commitPanelDrop functions when making the change. ``` </details> <!-- fingerprinting:phantom:medusa:grasshopper --> <!-- This is an auto-generated comment by CodeRabbit -->
  - src/backend/webui-dashboard-panel-layout.ts:64 _⚠️ Potential issue_ | _🟡 Minor_ **Keep the live region out of the button's persistent description.** `#dashboard-panel-reorder-status` is transient feedback, not static help text. Including it in `aria-describedby` means screen readers can re-read the last reorder message every time any drag handle receives focus, even when that message is stale. Keep the static hint here and let the live region announce updates independently. <details> <summary>♿ Suggested fix</summary> ```diff - aria-describedby="dashboard-panel-reorder-hint dashboard-panel-reorder-status" + aria-describedby="dashboard-panel-reorder-hint" ``` </details> <!-- suggestion_start --> <details> <summary>📝 Committable suggestion</summary> > ‼️ **IMPORTANT** > Carefully review the code before committing. Ensure that it accurately replaces the highlighted code, contains no missing lines, and has no issues with indentation. Thoroughly test & benchmark the code to ensure it meets the requirements. ```suggestion aria-describedby="dashboard-panel-reorder-hint" aria-keyshortcuts="Space Enter ArrowUp ArrowDown Escape" ``` </details> <!-- suggestion_end --> <details> <summary>🤖 Prompt for AI Agents</summary> ``` Verify each finding against the current code and only fix it if needed. In `@src/backend/webui-dashboard-panel-layout.ts` around lines 63 - 64, Remove the live region id from the button's persistent description: update the element that sets aria-describedby (the drag-handle button) so it only references "dashboard-panel-reorder-hint" and not "dashboard-panel-reorder-status"; leave the transient status element with id "dashboard-panel-reorder-status" as an independent live region (aria-live) so it can announce updates without being included in aria-describedby. Ensure the identifiers "dashboard-panel-reorder-hint" and "dashboard-panel-reorder-status" are used as described to locate and modify the attributes. ``` </details> <!-- fingerprinting:phantom:medusa:grasshopper --> <!-- This is an auto-generated comment by CodeRabbit -->

## Codex Working Notes
### Current Handoff
- Hypothesis: the remaining review fixes stay local to the browser-layer drag helpers and static panel markup: translate the first keyboard `ArrowDown` to the correct insertion slot, clear stale drag CSS before a new pointer drag starts, preserve specific drop/cancel live-region messages across `dragend`, and keep the transient live region out of persistent button descriptions.
- What changed: updated `src/backend/webui-dashboard-browser-script.ts` so the first keyboard `ArrowDown` selects the correct insertion target, pointer `dragstart` clears any stale drag state, and `dragend` only emits the generic completion message when a drop path did not already finalize the status; updated `src/backend/webui-dashboard-panel-layout.ts` so drag handles only describe the static reorder hint; and extended `src/backend/webui-dashboard.test.ts` with focused regressions for keyboard downward movement, stale keyboard-state cleanup on pointer drag start, and preserving success/cancel live-region messages after `dragend`.
- Current blocker: none
- Next exact step: commit and push the review fixes on `codex/issue-850`, then update PR `#865` for the resolved automated review threads.
- Verification gap: none locally; the focused dashboard/unit/browser-smoke verification command and `npm run build` both passed after the review-fix patch.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/backend/webui-dashboard-browser-script.ts`, `src/backend/webui-dashboard-panel-layout.ts`, `src/backend/webui-dashboard.test.ts`
- Rollback concern: low; the change is confined to WebUI markup/CSS/browser behavior and keeps the CLI, HTTP API, and safe-command transport untouched.
- Last focused command: `npm run build`
- Last focused failure: none
- Last focused commands:
```bash
sed -n '1,220p' "$HOME/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-850/AGENTS.generated.md"
sed -n '1,220p' "$HOME/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-850/context-index.md"
sed -n '1,260p' .codex-supervisor/issue-journal.md
git status --short --branch
sed -n '220,340p' src/backend/webui-dashboard-browser-script.ts
sed -n '960,1035p' src/backend/webui-dashboard-browser-script.ts
sed -n '48,90p' src/backend/webui-dashboard-panel-layout.ts
rg -n "ArrowDown|ArrowUp|dragstart|dragend|aria-describedby|dashboard-panel-reorder-status|keyboard" src/backend/webui-dashboard*.test.ts src/backend/webui-dashboard-browser-logic.test.ts
sed -n '675,745p' src/backend/webui-dashboard.test.ts
sed -n '200,275p' src/backend/webui-dashboard-browser-smoke.test.ts
sed -n '488,508p' src/backend/webui-dashboard.test.ts
sed -n '526,690p' src/backend/webui-dashboard.test.ts
sed -n '683,730p' src/backend/webui-dashboard.test.ts
npx tsx --test src/backend/webui-dashboard.test.ts
npx tsx --test src/backend/webui-dashboard-browser-logic.test.ts src/backend/webui-dashboard.test.ts src/backend/webui-dashboard-browser-smoke.test.ts
npm run build
date -u +%Y-%m-%dT%H:%M:%SZ
git rev-parse HEAD
git status --short --branch
```
### Scratchpad
- 2026-03-23T00:00:50Z: verified all four CodeRabbit review findings against the current branch, patched the browser drag helpers and panel handle accessibility markup, added focused regressions for `ArrowDown`, stale keyboard-state cleanup on pointer drag start, and dragend status preservation, and passed `npx tsx --test src/backend/webui-dashboard-browser-logic.test.ts src/backend/webui-dashboard.test.ts src/backend/webui-dashboard-browser-smoke.test.ts` plus `npm run build`.
- 2026-03-22T22:37:34Z: fixed the CodeRabbit review threads locally by rejecting cross-lane panel drops before mutating browser layout state, adding a focused cross-lane drag regression, sanitizing workstation-local paths from the issue journal, and rerunning `npx tsx --test src/backend/webui-dashboard-browser-logic.test.ts src/backend/webui-dashboard.test.ts`.
- 2026-03-22T22:21:32Z: reran `npx tsx --test src/backend/webui-dashboard-browser-logic.test.ts src/backend/webui-dashboard.test.ts`, pushed `codex/issue-848`, and opened draft PR `#858` for the drag-reorder checkpoint.
- 2026-03-22T22:09:23Z: reproduced the drag-reorder gap with a pure browser-logic regression, then added draggable panel handles, browser-only DOM reorder state, and a runtime dashboard drag test; `npx tsx --test src/backend/webui-dashboard-browser-logic.test.ts src/backend/webui-dashboard.test.ts` passed.
- 2026-03-22T21:40:05Z: pushed `codex/issue-847` and opened draft PR `#857` for the verified dashboard refresh checkpoint.
- 2026-03-22T21:40:05Z: reproduced the visual-refresh gap with a new hero-and-section framing regression, refreshed the dashboard page chrome/CSS to add labeled lanes and flatter surfaces, and passed `npx tsx --test src/backend/webui-dashboard.test.ts src/backend/webui-dashboard-browser-logic.test.ts`.
- 2026-03-22T21:15:08Z: pushed `codex/issue-846` and opened draft PR `#856`; GitHub currently reports `mergeStateStatus=UNSTABLE`, so the next turn should inspect CI/check runs and address any failures or review feedback.
- 2026-03-22T21:14:15Z: confirmed there was no existing PR for `codex/issue-846`; next step is to push the branch and open a draft PR with commit `c4e2a04`.
- 2026-03-22T21:02:11Z: reproduced the issue with a new shell-structure regression, then passed the focused verification command after moving all dashboard panels onto a shared shell helper with a reserved drag slot and shared subtitle/meta/action lanes.
- 2026-03-22T20:06:27Z: committed the typed dashboard panel layout work as `a6f6ea0`, pushed `codex/issue-845`, and opened draft PR `#855` at https://github.com/TommyKammy/codex-supervisor/pull/855.
- 2026-03-22T20:04:56Z: added typed dashboard panel ids, registry, default layout state, and normalization in `src/backend/webui-dashboard-panel-layout.ts`, then switched `src/backend/webui-dashboard-page.ts` to render from the registry so DOM order is driven by typed layout data rather than duplicated markup order.
- 2026-03-22T20:04:56Z: added focused regressions in `src/backend/webui-dashboard-browser-logic.test.ts` and `src/backend/webui-dashboard.test.ts`; `npx tsx --test src/backend/webui-dashboard-browser-logic.test.ts src/backend/webui-dashboard.test.ts` passed twice on the local diff.
