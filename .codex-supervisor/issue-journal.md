# Issue #815: WebUI browser confidence: add smoke coverage for read-only and safe-command workflows

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/815
- Branch: codex/issue-815
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 2 (implementation=1, repair=1)
- Last head SHA: a37caacb51ec5939d28e39a0669335517c0798e3
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ8518nWI
- Repeated failure signature count: 1
- Updated at: 2026-03-22T05:18:51.697Z

## Latest Codex Summary
Added browser-level WebUI smoke coverage in [src/backend/webui-dashboard-browser-smoke.test.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-815/src/backend/webui-dashboard-browser-smoke.test.ts), using `playwright-core` against the live in-process HTTP server fixture. The new smoke suite covers the read-only dashboard load and a confirmed `prune-orphaned-workspaces` flow through the actual browser UI. I also added `npm run test:webui-smoke` in [package.json](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-815/package.json) and documented the `CHROME_BIN` browser override in [README.md](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-815/README.md) and [docs/getting-started.md](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-815/docs/getting-started.md).

The focused reproducer was the initial smoke-test failure `Cannot find module 'playwright-core'`; that is resolved. Changes are committed on `codex/issue-815`, pushed, and draft PR `#821` is open: https://github.com/TommyKammy/codex-supervisor/pull/821

Summary: Added a real browser smoke harness for WebUI read-only load and a safe-command flow, plus the npm script, dependency, docs, commit, push, and draft PR.
State hint: waiting_ci
Blocked reason: none
Tests: `npx tsx --test src/backend/webui-dashboard.test.ts src/backend/supervisor-http-server.test.ts`; `npm run test:webui-smoke`; `npm run build`
Failure signature: none
Next action: Monitor PR #821 for CI startup and fix any remote failures, especially on the new `npm run test:webui-smoke` job

## Active Failure Context
- Category: review
- Summary: 1 unresolved automated review thread(s) remain.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/821#discussion_r2971014498
- Details:
  - README.md:57 _⚠️ Potential issue_ | _🟡 Minor_ **Align executable discovery wording with actual resolver list.** Line 57 currently mentions only `google-chrome` and `chromium`, but the resolver also checks `google-chrome-stable` and `chromium-browser`. Updating the text avoids operator confusion. <details> <summary>📝 Suggested doc tweak</summary> ```diff - The smoke harness launches a local Chrome/Chromium binary through `playwright-core` against an in-process HTTP fixture. If your browser executable is not on a standard `google-chrome` or `chromium` path, set `CHROME_BIN=/path/to/browser`. + The smoke harness launches a local Chrome/Chromium binary through `playwright-core` against an in-process HTTP fixture. If your browser executable is not on a standard `google-chrome`, `google-chrome-stable`, `chromium`, or `chromium-browser` path, set `CHROME_BIN=/path/to/browser`. ``` </details> <!-- suggestion_start --> <details> <summary>📝 Committable suggestion</summary> > ‼️ **IMPORTANT** > Carefully review the code before committing. Ensure that it accurately replaces the highlighted code, contains no missing lines, and has no issues with indentation. Thoroughly test & benchmark the code to ensure it meets the requirements. ```suggestion The smoke harness launches a local Chrome/Chromium binary through `playwright-core` against an in-process HTTP fixture. If your browser executable is not on a standard `google-chrome`, `google-chrome-stable`, `chromium`, or `chromium-browser` path, set `CHROME_BIN=/path/to/browser`. ``` </details> <!-- suggestion_end --> <details> <summary>🤖 Prompt for AI Agents</summary> ``` Verify each finding against the current code and only fix it if needed. In `@README.md` at line 57, Update the README sentence that describes how the smoke harness finds a local Chrome/Chromium executable (the line mentioning CHROME_BIN and playwright-core) to list all executables the resolver checks — include "google-chrome-stable" and "chromium-browser" in addition to "google-chrome" and "chromium" — so the CHROME_BIN guidance matches the actual resolver list used by the harness. ``` </details> <!-- fingerprinting:phantom:poseidon:hawk --> <!-- This is an auto-generated comment by CodeRabbit -->

## Codex Working Notes
### Current Handoff
- Hypothesis: the remaining confidence gap for the WebUI was missing browser-level coverage across the actual HTTP shell, SSE connection, and safe-command button flow; existing VM-based script tests were narrower than the new acceptance criteria.
- What changed: added a Playwright-core-backed smoke test that launches a real headless Chrome/Chromium against `createSupervisorHttpServer()`, covers read-only dashboard load, and exercises the confirmed prune-workspaces command path end to end through the browser UI.
- Current blocker: CodeRabbit review thread `PRRT_kwDORgvdZ8518nWI` identified a README wording mismatch with the smoke harness executable resolver list.
- Next exact step: land the README wording fix, push `codex/issue-815`, and resolve the automated review thread if no other review feedback appears.
- Verification gap: no runtime verification gap from the earlier green focused test/build pass; this review turn changes docs only and needs the README text checked against the resolver implementation.
- Files touched: `.codex-supervisor/issue-journal.md`, `README.md`, `docs/getting-started.md`, `package-lock.json`, `package.json`, `src/backend/webui-dashboard-browser-smoke.test.ts`
- Rollback concern: keep the smoke harness fixture-only and browser-binary-driven through `CHROME_BIN` so the suite stays deterministic and does not grow into network-dependent end-to-end coverage.
- Last focused command: `git diff -- README.md`
- Last focused failure: `PRRT_kwDORgvdZ8518nWI`
- Last focused commands:
```bash
npx tsx --test src/backend/webui-dashboard.test.ts src/backend/supervisor-http-server.test.ts
npx tsx --test src/backend/webui-dashboard-browser-smoke.test.ts
npm install --save-dev playwright-core
npm run test:webui-smoke
npm run build
rg -n "google-chrome|chromium-browser|google-chrome-stable|CHROME_BIN|playwright-core" README.md docs/getting-started.md src package.json
git diff -- README.md
```
### Scratchpad
- 2026-03-22T00:00:00Z: validated CodeRabbit thread `PRRT_kwDORgvdZ8518nWI`; the review was correct because `README.md` mentioned only `google-chrome` and `chromium` while `resolveChromeExecutable()` also checks `google-chrome-stable` and `chromium-browser`.
- 2026-03-22T00:00:00Z: updated the README smoke-harness note to list all resolver candidates; `docs/getting-started.md` already matched the implementation, so no shared-doc follow-up was needed there.
- 2026-03-22T00:00:00Z: documented the browser harness in `README.md` and `docs/getting-started.md`, including the `CHROME_BIN` override for CI or nonstandard local browser paths.
- 2026-03-22T00:00:00Z: focused verification passed with `npx tsx --test src/backend/webui-dashboard.test.ts src/backend/supervisor-http-server.test.ts`, `npm run test:webui-smoke`, and `npm run build`.
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
