# Issue #814: WebUI safe-command UX: improve confirmations, in-flight feedback, and post-action guidance

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/814
- Branch: codex/issue-814
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: a3eb355e37e09562725bd736d410efb2151e36b5
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-22T04:37:32.651Z

## Latest Codex Summary
- Reproduced the #814 safe-command UX gap with a deferred `run-once` dashboard test: buttons locked during execution, but the command result pane stayed on its placeholder text and gave no in-flight guidance.
- Updated the dashboard browser script to publish explicit in-progress, rejected, and refresh-failure command payloads with next-step guidance, and added a static operator-actions hint describing serialized command execution and post-action feedback.
- Focused verification passed with `npx tsx --test src/backend/webui-dashboard.test.ts src/backend/supervisor-http-server.test.ts` and `npm run build` after restoring local dependencies via `npm ci` because `tsc` was initially missing in this worktree.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: safe commands still felt ambiguous in the WebUI because the lock only disabled buttons; operators did not get explicit in-flight JSON state, rejection guidance, or refresh-failure recovery guidance in the command result area.
- What changed: added a reproducing deferred-response dashboard test for in-flight command feedback, updated command rendering to emit `in_progress` payloads plus guidance for rejection and refresh-failure cases, and added an operator-actions hint explaining serialized command execution and where confirmations/post-action feedback appear.
- Current blocker: none
- Next exact step: commit the #814 dashboard UX checkpoint, push `codex/issue-814`, and open or update the draft PR if one is not already present.
- Verification gap: none locally after the focused tests and build passed; remaining uncertainty is limited to remote CI and PR review once the checkpoint is pushed.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/backend/webui-dashboard-browser-script.ts`, `src/backend/webui-dashboard-page.ts`, `src/backend/webui-dashboard.test.ts`
- Rollback concern: keep the new guidance scoped to browser-side presentation only so the safe command set and backend command contract stay unchanged.
- Last focused command: `npm run build`
- Last focused failure: `safe-command in-flight result area remained on placeholder text while a command was running`
- Last focused commands:
```bash
npx tsx --test src/backend/webui-dashboard.test.ts
npx tsx --test src/backend/webui-dashboard.test.ts src/backend/supervisor-http-server.test.ts
npm ci
npm run build
```
### Scratchpad
- 2026-03-22T00:00:00Z: reproduced #814 with a deferred `run-once` dashboard test; buttons disabled correctly, but the command result pane stayed on its placeholder text until the POST resolved.
- 2026-03-22T00:00:00Z: updated browser-side safe-command rendering to publish explicit `in_progress`, rejection, and refresh-failure guidance, and added a static operator hint describing serialized command execution.
- 2026-03-22T00:00:00Z: `npm run build` initially failed with `sh: 1: tsc: not found`; `npm ci` restored local dependencies and the rerun passed.
- 2026-03-22T03:28:21Z: focused verification passed with `npx tsx --test src/backend/webui-dashboard-browser-logic.test.ts src/backend/webui-dashboard.test.ts src/backend/supervisor-http-server.test.ts` and `npm run build` after `npm ci` restored `tsc` in this worktree.
- 2026-03-22T00:00:00Z: reproduced missing rejection feedback with a confirm-decline dashboard case for prune workspaces; the browser returned early without a visible command result until declined confirmations were routed through a rejected-command renderer.
- 2026-03-22T00:00:00Z: focused verification passed with `npx tsx --test src/backend/webui-dashboard.test.ts`, `npx tsx --test src/backend/webui-dashboard.test.ts src/backend/supervisor-http-server.test.ts`, `npm ci`, and `npm run build`.
- 2026-03-21T23:43:40Z: reran the focused verification from the stabilizing checkpoint; `npx tsx --test src/backend/webui-dashboard.test.ts src/backend/supervisor-http-server.test.ts` and `npm run build` both passed on `f677ae4`.
- 2026-03-21T23:44:23Z: pushed `codex/issue-802` to origin and opened draft PR #807 (`https://github.com/TommyKammy/codex-supervisor/pull/807`) after the focused verification stayed green.
- 2026-03-21T23:07:19Z: reproduced the current #801 gap with a new dashboard test that expected typed runnable/blocked issues to expose clickable shortcuts for explain and issue-lint without using the manual number field.
- 2026-03-21T23:07:19Z: added a read-only typed issue shortcut strip to the dashboard, deduped across active/runnable/blocked/tracked issue DTOs, and reused the existing `loadIssue()` path for inspection.
- 2026-03-21T23:07:19Z: focused verification passed with `npx tsx --test src/backend/webui-dashboard.test.ts`, `npx tsx --test src/backend/webui-dashboard.test.ts src/backend/supervisor-http-server.test.ts`, and `npm run build` after restoring local dependencies via `npm ci`.
- 2026-03-21T23:07:19Z: committed `9921e48` (`Add typed dashboard issue shortcuts`), pushed `codex/issue-801`, and opened draft PR #806 (`https://github.com/TommyKammy/codex-supervisor/pull/806`).
- 2026-03-22T00:00:00Z: reproduced the issue with a new dashboard harness case that supplied typed tracked/blocked/candidate-discovery data but no legacy readiness lines; the dashboard rendered `No status lines reported.`
- 2026-03-22T00:00:00Z: refactored readiness assembly to emit typed runnable and blocked issue collections alongside the existing line-based summary, and added typed tracked issue DTOs plus typed candidate-discovery summary fields to `statusReport()`.
- 2026-03-22T00:00:00Z: focused verification passed; `npm run build` again needed a local `npm ci` because `tsc` was missing in this worktree.
- 2026-03-22T00:00:00Z: pushed `codex/issue-800` and opened draft PR #805 (`https://github.com/TommyKammy/codex-supervisor/pull/805`).
- 2026-03-21T22:43:04Z: validated CodeRabbit thread `PRRT_kwDORgvdZ8517C9c`; the review comment was correct because readiness was using only `listCandidateIssues()` for blocker/predecessor checks.
- 2026-03-21T22:43:04Z: fixed `buildReadinessSummary()` to iterate candidate issues but evaluate blockers and readiness reasons against `listAllIssues()`, and added regressions for both the summary builder and `Supervisor.statusReport()`.
- 2026-03-21T22:43:04Z: focused verification passed with `npx tsx --test src/supervisor/supervisor-selection-readiness-summary.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts src/backend/supervisor-http-server.test.ts src/backend/webui-dashboard.test.ts` and `npm run build`.
