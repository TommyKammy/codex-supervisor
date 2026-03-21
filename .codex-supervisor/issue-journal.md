# Issue #787: WebUI commands MVP: add narrow operator actions for existing safe backend commands

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/787
- Branch: codex/issue-787
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: ceaa503f2d4378882b49f9bf2943eb8be23e8757
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-21T20:18:08.246Z

## Latest Codex Summary
- None yet.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the remaining gap on this branch was the dashboard UI itself; backend command APIs already existed, but the WebUI still exposed only read-only views and needed a narrow operator action surface.
- What changed: tightened the existing dashboard-shell test to assert the four safe command routes and result panel hooks, reproduced the missing `/api/commands/*` action references in the HTML, then added an Operator actions panel with `run-once`, `requeue`, `prune-orphaned-workspaces`, and `reset-corrupt-json-state`, confirmation prompts for prune/reset, and structured JSON result rendering routed only through backend command endpoints.
- Current blocker: none
- Next exact step: commit the dashboard MVP update, then push the branch and refresh PR #796 with the focused UI action coverage.
- Verification gap: manual browser verification against a live backend still remains for the operator action flow.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/backend/supervisor-http-server.test.ts`, `src/backend/webui-dashboard.ts`
- Rollback concern: keep the HTTP command surface narrow and transport-level only; do not add loop control or any new mutation authority before the backend/UI MVP is stabilized.
- Last focused command: `npx tsx --test src/backend/supervisor-http-server.test.ts --test-name-pattern="dashboard shell with only the safe operator command actions"`
- Last focused failure: `AssertionError: /api/commands/run-once/ missing from dashboard HTML before adding the operator actions panel`
- Last focused commands:
```bash
npm ci
npx tsx --test src/backend/supervisor-http-server.test.ts --test-name-pattern="dashboard shell with only the safe operator command actions"
npx tsx --test src/backend/supervisor-http-server.test.ts
npm run build
```
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
- Local dirt besides this work remains the pre-existing untracked `.codex-supervisor/replay/` directory.
- `npm ci` was required locally because `npm run build` initially failed with `sh: 1: tsc: not found`.
- The new backend tests cover the intended allowlist and keep `loop` blocked at the HTTP layer with `404`.
- 2026-03-21T20:21:01Z: reproduced the WebUI gap with a tightened dashboard-shell test, then added the four safe operator actions, prune/reset confirmation prompts, and a structured command result panel in `src/backend/webui-dashboard.ts`.
- Draft PR: https://github.com/TommyKammy/codex-supervisor/pull/796
- Timezone note: `Updated at` is recorded in UTC, but scratchpad notes may cite
  the same event in local JST.
- Review fix on 2026-03-22: CodeRabbit thread `PRRT_kwDORgvdZ8515_nW` was valid; `createStubService()` could reach `args!` in the prune/reset stubs. Guarding those counters keeps the helper safe when called without tracking state.
- Review fix on 2026-03-22: CodeRabbit thread `PRRT_kwDORgvdZ8516Cux` is valid; the journal summary used a worktree-local absolute path that would not resolve on GitHub. Converting that committed link to a repo-relative target preserves the record and fixes the portability issue.
- Review state on 2026-03-22: after pushing `6898b72`, GraphQL confirmed both current CodeRabbit review threads on PR #796 are resolved.
- Updated at: 2026-03-21T19:41:57Z
