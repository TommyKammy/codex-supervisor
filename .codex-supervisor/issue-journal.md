# Issue #875: Operator timeline follow-up: enrich recent command, recovery, and phase-change context

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/875
- Branch: codex/issue-875
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 4943edf5f198cf3f3488fd65de5e0193269899eb
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-23T10:38:53.589Z

## Latest Codex Summary
- Added richer operator-timeline summaries for typed recovery commands and supervisor follow-up events so recent command, refresh, recovery, and active-issue changes read as one compact sequence.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the WebUI operator timeline should reuse typed command DTO fields and typed supervisor SSE payload fields so recent command outcomes, refresh follow-up, recovery reasons, and active-issue transitions are understandable without reading the raw JSON payloads.
- What changed: added shared browser-side timeline formatters in `src/backend/webui-dashboard-browser-logic.ts` for typed command results and richer supervisor event summaries, injected those helpers into the inline dashboard browser bundle, switched command timeline cards to render typed recovery/state-transition summaries, and added focused regressions in `src/backend/webui-dashboard-browser-logic.test.ts` plus `src/backend/webui-dashboard.test.ts`.
- Current blocker: none
- Next exact step: commit the dashboard timeline shaping checkpoint, push `codex/issue-875`, and open or update the draft PR for review/CI.
- Verification gap: none on the scoped operator timeline path; `npx tsx --test src/backend/webui-dashboard-browser-logic.test.ts src/backend/webui-dashboard.test.ts src/backend/supervisor-http-server.test.ts` passes on the local diff.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/backend/webui-dashboard-browser-logic.test.ts`, `src/backend/webui-dashboard-browser-logic.ts`, `src/backend/webui-dashboard-browser-script.ts`, `src/backend/webui-dashboard.test.ts`
- Rollback concern: low; the change is isolated to dashboard timeline copy/formatting and focused browser-side tests, with no change to the HTTP command surface or SSE transport.
- Last focused command: `npx tsx --test src/backend/webui-dashboard-browser-logic.test.ts src/backend/webui-dashboard.test.ts src/backend/supervisor-http-server.test.ts`
- Last focused failure: before the patch, operator timeline command cards used generic backend summaries such as `Requeued issue #42.` and follow-up events used raw reason tokens like `reserved_for_cycle`, so operators could not see compact recovery state transitions or humanized follow-up context in sequence; the focused verification command now passes.
- Last focused commands:
```bash
sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-875/AGENTS.generated.md
sed -n '1,260p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-875/context-index.md
sed -n '1,320p' .codex-supervisor/issue-journal.md
git status --short --branch
rg -n "timeline|recent command|recovery|phase-change|active issue|operator timeline|recent-history|refresh|command result" src/backend src -g '!node_modules'
sed -n '1,260p' src/backend/webui-dashboard.test.ts
sed -n '1,260p' src/backend/webui-dashboard-browser-logic.test.ts
sed -n '1,260p' src/backend/supervisor-http-server.test.ts
sed -n '330,440p' src/backend/webui-dashboard-browser-logic.ts
sed -n '650,780p' src/backend/webui-dashboard-browser-script.ts
sed -n '780,860p' src/backend/webui-dashboard-browser-script.ts
sed -n '860,1040p' src/backend/webui-dashboard-browser-script.ts
sed -n '1036,1328p' src/backend/webui-dashboard-browser-script.ts
sed -n '1,240p' src/supervisor/supervisor-events.ts
apply_patch
npx tsx --test src/backend/webui-dashboard-browser-logic.test.ts src/backend/webui-dashboard.test.ts
apply_patch
npx tsx --test src/backend/webui-dashboard-browser-logic.test.ts src/backend/webui-dashboard.test.ts src/backend/supervisor-http-server.test.ts
git diff -- src/backend/webui-dashboard-browser-logic.ts src/backend/webui-dashboard-browser-logic.test.ts src/backend/webui-dashboard-browser-script.ts src/backend/webui-dashboard.test.ts .codex-supervisor/issue-journal.md
date -u +%Y-%m-%dT%H:%M:%SZ
```
### Scratchpad
- 2026-03-23T10:43:22Z: reproduced the WebUI timeline gap with a new requeue/active-issue wording regression, then passed `npx tsx --test src/backend/webui-dashboard-browser-logic.test.ts src/backend/webui-dashboard.test.ts src/backend/supervisor-http-server.test.ts` after switching timeline cards to typed command summaries and humanized follow-up event summaries.
- 2026-03-22T21:15:08Z: pushed `codex/issue-846` and opened draft PR `#856`; GitHub currently reports `mergeStateStatus=UNSTABLE`, so the next turn should inspect CI/check runs and address any failures or review feedback.
- 2026-03-22T21:14:15Z: confirmed there was no existing PR for `codex/issue-846`; next step is to push the branch and open a draft PR with commit `c4e2a04`.
- 2026-03-22T21:02:11Z: reproduced the issue with a new shell-structure regression, then passed the focused verification command after moving all dashboard panels onto a shared shell helper with a reserved drag slot and shared subtitle/meta/action lanes.
- 2026-03-22T20:06:27Z: committed the typed dashboard panel layout work as `a6f6ea0`, pushed `codex/issue-845`, and opened draft PR `#855` at https://github.com/TommyKammy/codex-supervisor/pull/855.
- 2026-03-22T20:04:56Z: added typed dashboard panel ids, registry, default layout state, and normalization in `src/backend/webui-dashboard-panel-layout.ts`, then switched `src/backend/webui-dashboard-page.ts` to render from the registry so DOM order is driven by typed layout data rather than duplicated markup order.
- 2026-03-22T20:04:56Z: added focused regressions in `src/backend/webui-dashboard-browser-logic.test.ts` and `src/backend/webui-dashboard.test.ts`; `npx tsx --test src/backend/webui-dashboard-browser-logic.test.ts src/backend/webui-dashboard.test.ts` passed twice on the local diff.
