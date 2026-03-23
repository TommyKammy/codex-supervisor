# Issue #871: WebUI drag-and-drop bug: fix asymmetric pointer reordering across dashboard columns

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/871
- Branch: codex/issue-871
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 2 (implementation=1, repair=1)
- Last head SHA: e264997db17fd7d7cbae26bb05157363cee9dc73
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ852DQTW
- Repeated failure signature count: 1
- Updated at: 2026-03-23T07:22:06.671Z

## Latest Codex Summary
Implemented and pushed the dashboard fix for pointer reordering. The change is on `codex/issue-871` as commit `e264997` and draft PR [#879](https://github.com/TommyKammy/codex-supervisor/pull/879).

The fix keeps keyboard reordering intact while adding a pointer-driven reorder path in [`src/backend/webui-dashboard-browser-script.ts`](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-871/src/backend/webui-dashboard-browser-script.ts) that tracks hovered panels via `elementFromPoint()` and avoids losing targets on bubbled child `dragleave` events. I also added a real-browser regression in [`src/backend/webui-dashboard-browser-smoke.test.ts`](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-871/src/backend/webui-dashboard-browser-smoke.test.ts) that exercises pointer reordering in both horizontal directions.

Verification passed:
- `npx tsx --test src/backend/webui-dashboard.test.ts src/backend/webui-dashboard-browser-smoke.test.ts`
- `npm run build`

GitHub currently shows PR `#879` as `UNSTABLE` only because `build (ubuntu-latest)` and `build (macos-latest)` are still pending. I also updated the issue journal locally, but that journal-only sync is not committed so the worktree still has [` .codex-supervisor/issue-journal.md`](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-871/.codex-supervisor/issue-journal.md) modified plus the existing untracked replay directory.

Summary: Fixed WebUI pointer panel reordering, added a real-browser regression for both horizontal directions, pushed commit `e264997`, and opened draft PR `#879`.
State hint: waiting_ci
Blocked reason: none
Tests: `npx tsx --test src/backend/webui-dashboard.test.ts src/backend/webui-dashboard-browser-smoke.test.ts`; `npm run build`
Failure signature: none
Next action: Wait for PR `#879` CI checks to finish and only intervene if `build (ubuntu-latest)` or `build (macos-latest)` fails.

## Active Failure Context
- Category: review
- Summary: 1 unresolved automated review thread(s) remain.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/879#discussion_r2973268865
- Details:
  - src/backend/webui-dashboard-browser-smoke.test.ts:361 _⚠️ Potential issue_ | _🟡 Minor_ **Potential test flakiness: missing wait after first drag operation.** The first drag asserts panel order immediately after `dragPanelHandle` returns (lines 352-361), while the second drag correctly uses `waitForFunction` to wait for the DOM to stabilize (lines 363-369). If the panel reorder involves any async DOM updates, the first assertion could intermittently fail. Consider adding a similar `waitForFunction` before the first assertion for consistency: <details> <summary>🛡️ Proposed fix for consistency</summary> ```diff await dragPanelHandle(page, "#panel-drag-operator-actions", "#panel-drag-operator-timeline"); + await page.waitForFunction( + () => + Array.from(document.querySelectorAll("#details-grid > article")) + .map((element) => element.id) + .join(",") === + "panel-issue-details,panel-tracked-history,panel-live-events,panel-operator-actions,panel-operator-timeline", + ); assert.equal(await page.textContent("#dashboard-panel-reorder-status"), "Moved operator actions panel before operator timeline."); ``` </details> <!-- suggestion_start --> <details> <summary>📝 Committable suggestion</summary> > ‼️ **IMPORTANT** > Carefully review the code before committing. Ensure that it accurately replaces the highlighted code, contains no missing lines, and has no issues with indentation. Thoroughly test & benchmark the code to ensure it meets the requirements. ```suggestion await dragPanelHandle(page, "#panel-drag-operator-actions", "#panel-drag-operator-timeline"); await page.waitForFunction( () => Array.from(document.querySelectorAll("#details-grid > article")) .map((element) => element.id) .join(",") === "panel-issue-details,panel-tracked-history,panel-live-events,panel-operator-actions,panel-operator-timeline", ); assert.equal(await page.textContent("#dashboard-panel-reorder-status"), "Moved operator actions panel before operator timeline."); assert.deepEqual( await page.locator("#details-grid > article").evaluateAll((elements) => elements.map((element) => element.id)), [ "panel-issue-details", "panel-tracked-history", "panel-live-events", "panel-operator-actions", "panel-operator-timeline", ], ); ``` </details> <!-- suggestion_end --> <details> <summary>🤖 Prompt for AI Agents</summary> ``` Verify each finding against the current code and only fix it if needed. In `@src/backend/webui-dashboard-browser-smoke.test.ts` around lines 350 - 361, The first drag's assertions are prone to race conditions; after calling dragPanelHandle for "#panel-drag-operator-actions" -> "#panel-drag-operator-timeline" you should await a waitForFunction that checks the DOM/order has updated (for example, poll the locator "#details-grid > article" and confirm the element ids equal the expected array and/or that "#dashboard-panel-reorder-status" text equals "Moved operator actions panel before operator timeline.") before running the assert.equal and assert.deepEqual; add this waitForFunction (similar to the second drag's implementation) to stabilize the DOM after dragPanelHandle. ``` </details> <!-- fingerprinting:phantom:medusa:ocelot --> <!-- This is an auto-generated comment by CodeRabbit -->

## Codex Working Notes
### Current Handoff
- Hypothesis: the remaining review feedback is valid and limited to smoke-test stability; the first pointer-drag assertion should wait for the reordered DOM state just like the second drag already does, without changing product behavior.
- What changed: added a `page.waitForFunction(...)` after the first `dragPanelHandle(page, "#panel-drag-operator-actions", "#panel-drag-operator-timeline")` call in `src/backend/webui-dashboard-browser-smoke.test.ts` so the test waits for the expected `#details-grid > article` order before asserting the reorder status text and panel ids.
- Current blocker: none
- Next exact step: commit and push this review fix on `codex/issue-871`, then resolve the automated PR thread on `#879`.
- Verification gap: none locally for this review fix; the focused dashboard/browser suite passed after the test change.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/backend/webui-dashboard-browser-smoke.test.ts`
- Rollback concern: low; the change only makes an existing browser smoke assertion wait for the DOM reorder it already expects.
- Last focused command: `npx tsx --test src/backend/webui-dashboard.test.ts src/backend/webui-dashboard-browser-smoke.test.ts`
- Last focused failure: `PRRT_kwDORgvdZ852DQTW` review thread about a potentially flaky immediate assertion after the first pointer drag; resolved locally by waiting for the reordered DOM state before asserting.
- Last focused commands:
```bash
sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-871/AGENTS.generated.md
sed -n '1,260p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-871/context-index.md
sed -n '1,260p' .codex-supervisor/issue-journal.md
sed -n '320,410p' src/backend/webui-dashboard-browser-smoke.test.ts
apply_patch
npx tsx --test src/backend/webui-dashboard.test.ts src/backend/webui-dashboard-browser-smoke.test.ts
git status --short --branch
date -u +%Y-%m-%dT%H:%M:%SZ
```
### Scratchpad
- 2026-03-23T07:22:48Z: validated the CodeRabbit flake note, added a DOM-order `waitForFunction` after the first pointer drag in `src/backend/webui-dashboard-browser-smoke.test.ts`, and re-passed `npx tsx --test src/backend/webui-dashboard.test.ts src/backend/webui-dashboard-browser-smoke.test.ts`.
- 2026-03-22T21:40:05Z: pushed `codex/issue-847` and opened draft PR `#857` for the verified dashboard refresh checkpoint.
- 2026-03-22T21:40:05Z: reproduced the visual-refresh gap with a new hero-and-section framing regression, refreshed the dashboard page chrome/CSS to add labeled lanes and flatter surfaces, and passed `npx tsx --test src/backend/webui-dashboard.test.ts src/backend/webui-dashboard-browser-logic.test.ts`.
- 2026-03-22T21:15:08Z: pushed `codex/issue-846` and opened draft PR `#856`; GitHub currently reports `mergeStateStatus=UNSTABLE`, so the next turn should inspect CI/check runs and address any failures or review feedback.
- 2026-03-22T21:14:15Z: confirmed there was no existing PR for `codex/issue-846`; next step is to push the branch and open a draft PR with commit `c4e2a04`.
- 2026-03-22T21:02:11Z: reproduced the issue with a new shell-structure regression, then passed the focused verification command after moving all dashboard panels onto a shared shell helper with a reserved drag slot and shared subtitle/meta/action lanes.
- 2026-03-22T20:06:27Z: committed the typed dashboard panel layout work as `a6f6ea0`, pushed `codex/issue-845`, and opened draft PR `#855` at https://github.com/TommyKammy/codex-supervisor/pull/855.
- 2026-03-22T20:04:56Z: added typed dashboard panel ids, registry, default layout state, and normalization in `src/backend/webui-dashboard-panel-layout.ts`, then switched `src/backend/webui-dashboard-page.ts` to render from the registry so DOM order is driven by typed layout data rather than duplicated markup order.
- 2026-03-22T20:04:56Z: added focused regressions in `src/backend/webui-dashboard-browser-logic.test.ts` and `src/backend/webui-dashboard.test.ts`; `npx tsx --test src/backend/webui-dashboard-browser-logic.test.ts src/backend/webui-dashboard.test.ts` passed twice on the local diff.
