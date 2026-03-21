# Issue #787: WebUI commands MVP: add narrow operator actions for existing safe backend commands

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/787
- Branch: codex/issue-787
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: draft_pr
- Attempt count: 4 (implementation=2, repair=2)
- Last head SHA: 6723ced481c8c3d782001468cd19cdcb0fba1acb
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ8516bxR|PRRT_kwDORgvdZ8516bxS|PRRT_kwDORgvdZ8516bxU|PRRT_kwDORgvdZ8516bxV|PRRT_kwDORgvdZ8516bxW
- Repeated failure signature count: 1
- Updated at: 2026-03-21T20:51:49Z

## Latest Codex Summary
Pushed `codex/issue-787` through `6723ced` and resolved the five outstanding CodeRabbit review threads on PR [#797](https://github.com/TommyKammy/codex-supervisor/pull/797). The branch now contains the dashboard safety fixes for requeue gating, refresh-after-success handling, duplicate command prevention, and the journal handoff cleanup that removed worktree-local summary links.

Added `src/backend/webui-dashboard.test.ts` to execute the inline dashboard script under a fake DOM so the UI-specific review regressions are covered directly. The only remaining gap is the original manual browser verification of the operator action flow against a live backend.

Summary: Pushed the remaining dashboard review fixes, resolved the PR #797 review threads, and left only manual browser verification
State hint: draft_pr
Blocked reason: none
Tests: `npx tsx --test src/backend/webui-dashboard.test.ts`; `npx tsx --test src/backend/supervisor-http-server.test.ts`; `npm run build`
Failure signature: none
Next action: manually verify the WebUI operator actions against a live backend, then move PR #797 toward review

## Active Failure Context
- Category: review
- Summary: The previously open automated review threads are now fixed on the branch and resolved on PR #797; the remaining work is manual browser verification.
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
- Next exact step: perform the remaining manual browser verification of the operator actions against a live backend, then move PR #797 out of draft when that check is complete.
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
- Updated at: 2026-03-21T20:51:49Z
