# Issue #787: WebUI commands MVP: add narrow operator actions for existing safe backend commands

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/787
- Branch: codex/issue-787
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: stabilizing
- Attempt count: 2 (implementation=2, repair=0)
- Last head SHA: d0d0ab56f52b87f2b346c2580c030fbd4ce2bbb6
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-21T20:31:41.431Z

## Latest Codex Summary
Added the WebUI operator action surface for the four existing safe backend commands in [webui-dashboard.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-787/src/backend/webui-dashboard.ts#L368). The dashboard now exposes `run-once`, `requeue`, `prune-orphaned-workspaces`, and `reset-corrupt-json-state`, keeps everything routed through `/api/commands/*`, requires browser confirmation for prune/reset, disables requeue until an issue is selected, and renders structured JSON command results in the UI.

I tightened the focused dashboard-shell test in [supervisor-http-server.test.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-787/src/backend/supervisor-http-server.test.ts#L555) to prove the missing UI surface first, then implemented the fix. I also updated the issue journal and committed the checkpoint as `d0d0ab5` on `codex/issue-787`. Local dirt remaining is only the pre-existing untracked `.codex-supervisor/replay/` directory.

Summary: Added the narrow WebUI operator actions panel, confirmation UX, and structured command result rendering; committed as `d0d0ab5`
State hint: draft_pr
Blocked reason: none
Tests: `npx tsx --test src/backend/supervisor-http-server.test.ts`; `npm run build`
Failure signature: none
Next action: push `codex/issue-787` and update draft PR #796 with the WebUI command MVP changes

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the remaining gap on this branch was the dashboard UI itself; backend command APIs already existed, but the WebUI still exposed only read-only views and needed a narrow operator action surface.
- What changed: tightened the existing dashboard-shell test to assert the four safe command routes and result panel hooks, reproduced the missing `/api/commands/*` action references in the HTML, then added an Operator actions panel with `run-once`, `requeue`, `prune-orphaned-workspaces`, and `reset-corrupt-json-state`, confirmation prompts for prune/reset, and structured JSON result rendering routed only through backend command endpoints.
- Current blocker: none
- Next exact step: monitor draft PR #797, then perform manual browser verification of the operator action flow against a live backend before moving out of stabilizing.
- Verification gap: manual browser verification against a live backend still remains for the operator action flow.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/backend/supervisor-http-server.test.ts`, `src/backend/webui-dashboard.ts`
- Rollback concern: keep the HTTP command surface narrow and transport-level only; do not add loop control or any new mutation authority before the backend/UI MVP is stabilized.
- Last focused command: `gh pr create --draft --base main --head codex/issue-787 --title "Add narrow WebUI operator actions" ...`
- Last focused failure: none
- Last focused commands:
```bash
npm ci
npx tsx --test src/backend/supervisor-http-server.test.ts --test-name-pattern="dashboard shell with only the safe operator command actions"
npx tsx --test src/backend/supervisor-http-server.test.ts
npm run build
git push -u origin codex/issue-787
gh pr create --draft --base main --head codex/issue-787 --title "Add narrow WebUI operator actions" --body ...
```
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
- Local dirt besides this work remains the pre-existing untracked `.codex-supervisor/replay/` directory.
- `npm ci` was required locally because `npm run build` initially failed with `sh: 1: tsc: not found`.
- The new backend tests cover the intended allowlist and keep `loop` blocked at the HTTP layer with `404`.
- 2026-03-21T20:21:01Z: reproduced the WebUI gap with a tightened dashboard-shell test, then added the four safe operator actions, prune/reset confirmation prompts, and a structured command result panel in `src/backend/webui-dashboard.ts`.
- 2026-03-21T20:34:00Z: pushed `d0d0ab5` to `origin/codex/issue-787` and opened draft PR #797 for this branch.
- Draft PR: https://github.com/TommyKammy/codex-supervisor/pull/797
- Timezone note: `Updated at` is recorded in UTC, but scratchpad notes may cite
  the same event in local JST.
- Review fix on 2026-03-22: CodeRabbit thread `PRRT_kwDORgvdZ8515_nW` was valid; `createStubService()` could reach `args!` in the prune/reset stubs. Guarding those counters keeps the helper safe when called without tracking state.
- Review fix on 2026-03-22: CodeRabbit thread `PRRT_kwDORgvdZ8516Cux` is valid; the journal summary used a worktree-local absolute path that would not resolve on GitHub. Converting that committed link to a repo-relative target preserves the record and fixes the portability issue.
- Review state on 2026-03-22: after pushing `6898b72`, GraphQL confirmed both current CodeRabbit review threads on PR #796 are resolved.
- Updated at: 2026-03-21T19:41:57Z
