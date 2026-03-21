# Issue #787: WebUI commands MVP: add narrow operator actions for existing safe backend commands

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/787
- Branch: codex/issue-787
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 4 (implementation=2, repair=2)
- Last head SHA: 2328fa72ef6e72669b74fe6eb4108487ab8de1a9
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ8516bxR|PRRT_kwDORgvdZ8516bxS|PRRT_kwDORgvdZ8516bxU|PRRT_kwDORgvdZ8516bxV|PRRT_kwDORgvdZ8516bxW
- Repeated failure signature count: 1
- Updated at: 2026-03-21T20:50:48Z

## Latest Codex Summary
Committed `2328fa7` on `codex/issue-787` to address the five outstanding CodeRabbit review findings locally. The journal handoff now avoids worktree-local summary links and points at the live PR `#797`, while the dashboard script now keeps requeue disabled until an issue loads successfully, preserves successful command results when follow-up refreshes fail, and prevents duplicate operator POSTs with a shared in-flight lock.

Added `src/backend/webui-dashboard.test.ts` to execute the inline dashboard script under a fake DOM so the UI-specific review regressions are covered directly. The worktree is clean aside from the pre-existing untracked `.codex-supervisor/replay/` directory.

Summary: Committed `2328fa7` with the remaining dashboard review fixes and direct UI regression tests
State hint: addressing_review
Blocked reason: none
Tests: `npx tsx --test src/backend/webui-dashboard.test.ts`; `npx tsx --test src/backend/supervisor-http-server.test.ts`; `npm run build`
Failure signature: none
Next action: push `codex/issue-787`, update PR #797, and resolve the corresponding review threads before the remaining manual browser verification pass

## Active Failure Context
- Category: review
- Summary: The five automated review threads were reproduced locally and fixed in commit `2328fa7`; the remaining work is to push that commit and resolve them on PR #797.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/797#discussion_r2970199904
- Details:
  - `.codex-supervisor/issue-journal.md`: the handoff summary now keeps links repo-relative and points the stale next action at PR `#797`.
  - `src/backend/webui-dashboard.ts`: requeue now stays disabled unless an issue has finished loading successfully.
  - `src/backend/webui-dashboard.ts`: `runCommand()` now preserves the successful backend result if the follow-up status or issue refresh fails, and surfaces the refresh problem separately.
  - `src/backend/webui-dashboard.ts`: all operator actions now share a command lock so duplicate POSTs are blocked while a request is in flight.
  - `src/backend/webui-dashboard.test.ts`: added direct regression coverage for optimistic issue loading, refresh-after-success failures, and duplicate command clicks.

## Codex Working Notes
### Current Handoff
- Hypothesis: the remaining gap on this branch is no longer the dashboard action surface itself; the review threads were about client-side safety details around button enablement, refresh handling, and duplicate submissions.
- What changed: fixed the dashboard script so requeue is only available after a successful issue load, successful command results survive follow-up refresh failures, and all operator actions share an in-flight lock. Added a direct script-level test harness for those UI regressions.
- Current blocker: none
- Next exact step: push commit `2328fa7`, update PR #797, and resolve the matching review threads before the remaining manual browser verification pass.
- Verification gap: manual browser verification against a live backend still remains for the operator action flow.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/backend/webui-dashboard.test.ts`, `src/backend/webui-dashboard.ts`
- Rollback concern: keep the HTTP command surface narrow and transport-level only; do not add loop control or any new mutation authority before the backend/UI MVP is stabilized.
- Last focused command: `npx tsx --test src/backend/webui-dashboard.test.ts`
- Last focused failure: the first draft of the new dashboard test exposed a missing `renderSelectedIssue()` call after a successful `loadIssue()`; adding that render fixed the regression and the test now passes.
- Last focused commands:
```bash
npx tsx --test src/backend/webui-dashboard.test.ts
npx tsx --test src/backend/supervisor-http-server.test.ts
npm run build
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
- Review fix on 2026-03-22: CodeRabbit threads `PRRT_kwDORgvdZ8516bxU`, `PRRT_kwDORgvdZ8516bxV`, and `PRRT_kwDORgvdZ8516bxW` were valid; the dashboard now gates requeue on a loaded issue, keeps successful command results when refreshes fail, and blocks duplicate command POSTs while one is already running.
- Review fix on 2026-03-22: added `src/backend/webui-dashboard.test.ts` to execute the inline dashboard script with a fake DOM and verify the review regressions directly.
- Review state on 2026-03-22: after pushing `6898b72`, GraphQL confirmed both current CodeRabbit review threads on PR #796 are resolved.
- Updated at: 2026-03-21T20:50:48Z
