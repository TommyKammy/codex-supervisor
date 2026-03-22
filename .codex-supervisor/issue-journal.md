# Issue #810: WebUI contract follow-up: expose typed operator activity context for richer issue detail views

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/810
- Branch: codex/issue-810
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 4 (implementation=2, repair=2)
- Last head SHA: cdfb2534fd680c22b462cbaeffa0377cb44e35ca
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ8517soX
- Repeated failure signature count: 1
- Updated at: 2026-03-22T01:54:01.000Z

## Latest Codex Summary
Patched both valid review findings and pushed them on `codex/issue-810` as `cdfb253`. The dashboard now prefers typed `activityContext.latestRecovery` over the legacy summary fallback, and `buildIssueExplainDto()` now degrades PR lookup failures to `pr = null` instead of aborting the explain response. I also added focused regressions for both paths, pushed the branch update to PR #816, and resolved the two addressed CodeRabbit threads.

Verification ran clean with `npx tsx --test src/backend/webui-dashboard.test.ts src/supervisor/supervisor-selection-issue-explain.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts src/backend/supervisor-http-server.test.ts` and `npm run build`.

Summary: Fixed the two outstanding PR #816 review regressions, added focused regressions, pushed `cdfb253`, and resolved both review threads.
State hint: pr_open
Blocked reason: none
Tests: `npx tsx --test src/backend/webui-dashboard.test.ts src/supervisor/supervisor-selection-issue-explain.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts src/backend/supervisor-http-server.test.ts`; `npm run build`
Failure signature: none
Next action: monitor PR #816 for fresh CI/results and handle any further review feedback

## Active Failure Context
- Category: review
- Summary: 1 unresolved automated review thread(s) remain.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/816#discussion_r2970658006
- Details:
  - `.codex-supervisor/issue-journal.md` still contains CodeRabbit excerpt text with MD038 violations from inline code spans that have inner leading or trailing spaces. Narrow fix: trim those code-span boundaries without changing the underlying review context.

## Codex Working Notes
### Current Handoff
- Hypothesis: the remaining PR review blockers were both valid regressions, and the narrowest safe repair is to prioritize typed `latestRecovery` in the dashboard while fail-closing explain-side PR lookup to `null`.
- What changed: updated `src/backend/webui-dashboard-browser-script.ts` so typed `activityContext.latestRecovery` is rendered before the legacy fallback summary; wrapped `resolvePullRequestForBranch()` in `src/supervisor/supervisor-selection-issue-explain.ts` so explain DTO construction degrades to `pr = null` on lookup errors; tightened `src/backend/webui-dashboard.test.ts` to prove legacy recovery text is fallback-only; added a focused PR-lookup failure regression in `src/supervisor/supervisor-selection-issue-explain.test.ts`.
- Current blocker: none
- Next exact step: verify the journal passes markdownlint after the MD038 cleanup, then commit and push the review-fix checkpoint to `codex/issue-810` and resolve the remaining PR #816 thread.
- Verification gap: rerun a journal-focused markdownlint check after replacing the malformed inline code spans in the stored review excerpt.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/backend/webui-dashboard-browser-script.ts`, `src/backend/webui-dashboard.test.ts`, `src/supervisor/supervisor-selection-issue-explain.test.ts`, `src/supervisor/supervisor-selection-issue-explain.ts`
- Rollback concern: `activityContext` is intentionally nullable for empty cases so older tests and consumers do not have to special-case empty objects; keep that behavior if the contract is reshaped.
- Last focused command: `npm run build`
- Last focused failure: `PRRT_kwDORgvdZ8517qsQ|PRRT_kwDORgvdZ8517qsT`; CodeRabbit flagged typed latest-recovery precedence and unguarded explain-side PR resolution.
- Last focused commands:
```bash
npx tsx --test src/backend/webui-dashboard.test.ts src/supervisor/supervisor-selection-issue-explain.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts src/backend/supervisor-http-server.test.ts
npm run build
```
### Scratchpad
- 2026-03-22T01:42:28Z: validated both CodeRabbit review threads as real regressions on `79a7ba7`, patched the dashboard to prefer typed latest-recovery data over the legacy summary, and guarded explain-side PR lookup failures by degrading to `pr = null`.
- 2026-03-22T01:42:28Z: focused verification passed with `npx tsx --test src/backend/webui-dashboard.test.ts src/supervisor/supervisor-selection-issue-explain.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts src/backend/supervisor-http-server.test.ts` and `npm run build`.
- 2026-03-22T01:56:22Z: reduced the stored CodeRabbit failure excerpt in `.codex-supervisor/issue-journal.md` to a concise MD038 summary so the journal no longer preserves malformed inline code spans verbatim; the direct backtick-boundary scan is now clean, while full markdownlint still reports unrelated long-standing journal style violations.
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
