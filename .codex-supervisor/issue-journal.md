# Issue #785: WebUI MVP: ship a read-only operator dashboard backed only by HTTP and SSE

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/785
- Branch: codex/issue-785
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 4 (implementation=2, repair=2)
- Last head SHA: 7c8fb28515b9458a26b6c5fa371ceb16d3df9a77
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ8515vMs
- Repeated failure signature count: 1
- Updated at: 2026-03-21T18:34:09.234Z

## Latest Codex Summary
Validated the last open CodeRabbit thread as real and fixed the remaining WebUI shutdown race in [supervisor-runtime.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-785/src/cli/supervisor-runtime.ts): stop signals now retain the last signal value and the `web` command re-checks `shouldStop` immediately after assigning `stopWebServer`, so a signal that lands during `listen()` still triggers graceful shutdown once the close handler exists. Added focused regression coverage in [supervisor-runtime.test.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-785/src/cli/supervisor-runtime.test.ts) for the pre-assignment signal path.

Verification passed with `npx tsx --test src/cli/supervisor-runtime.test.ts` and `npm run build`. Worktree still includes the pre-existing untracked `.codex-supervisor/replay/` directory.

Summary: Fixed the remaining WebUI stop-signal race reported in PR review and added a regression test for it.
State hint: addressing_review
Blocked reason: none
Tests: `npx tsx --test src/cli/supervisor-runtime.test.ts`; `npm run build`
Failure signature: none
Next action: Commit and push this review fix, then update/respond on PR #795 review threads

## Active Failure Context
- Category: review
- Summary: 1 unresolved automated review thread(s) remain.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/795#discussion_r2969937040
- Details:
  - src/cli/supervisor-runtime.ts:131 _⚠️ Potential issue_ | _🟠 Major_ **Race condition: early signal arrival prevents WebUI shutdown.** If a signal (SIGINT/SIGTERM) arrives after `registerStopSignals` but before `stopWebServer` is assigned (line 201), the `process.once` handler is consumed without calling `stopWebServer`. The server then starts and runs indefinitely with no way to trigger graceful shutdown via signals. Consider checking `shouldStop` after assigning `stopWebServer` and immediately shutting down if a signal already arrived: <details> <summary>🛠️ Proposed fix</summary> ```diff stopWebServer = () => { server.closeAllConnections?.(); server.close((error) => complete(error ?? undefined)); }; + if (shouldStop) { + stopWebServer(); + } }); ``` </details> <details> <summary>🤖 Prompt for AI Agents</summary> ``` Verify each finding against the current code and only fix it if needed. In `@src/cli/supervisor-runtime.ts` around lines 120 - 131, The signal handler registered via registerStopSignals can run before stopWebServer is assigned causing missed shutdowns; after you set the stopWebServer closure (the assignment to stopWebServer), immediately check the shared flag shouldStop and, if it's true, write the same shutdown log and invoke stopWebServer() to perform the WebUI shutdown; ensure this check is placed right after the assignment so the handler's earlier consumption still triggers a graceful shutdown via the stopWebServer function. ``` </details> <!-- fingerprinting:phantom:medusa:ocelot --> <!-- This is an auto-generated comment by CodeRabbit -->

## Codex Working Notes
### Current Handoff
- Hypothesis: the only remaining review risk was a stop-signal race in `web` mode where `registerStopSignals()` could fire before `stopWebServer` existed, so the correct fix is to preserve the signal and re-check `shouldStop` immediately after wiring the server close function.
- What changed: updated `src/cli/supervisor-runtime.ts` to store the last stop signal and immediately shut down the WebUI if `shouldStop` was already set when `stopWebServer` is assigned; added a focused runtime regression test covering a signal that arrives during `listen()` before the close handler exists.
- Current blocker: none
- Next exact step: commit and push the runtime race fix, then update PR #795 review threads and return to the remaining manual browser verification gap.
- Verification gap: automated verification for the review fix passed; the broader issue still needs the real browser pass with a live emitted SSE event.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/backend/supervisor-http-server.ts`, `src/backend/supervisor-http-server.test.ts`, `src/backend/webui-dashboard.ts`, `src/cli/entrypoint.test.ts`, `src/cli/parse-args.test.ts`, `src/cli/parse-args.ts`, `src/cli/supervisor-runtime.test.ts`, `src/cli/supervisor-runtime.ts`, `src/core/types.ts`
- Rollback concern: keep the dashboard thin and transport-driven; avoid pulling supervisor state interpretation or mutation workflows into the browser, and avoid coupling the UI to local files outside the existing HTTP/SSE surface.
- Last focused command: `npm run build`
- Last focused failure: none
- Last focused commands:
```bash
npx tsx --test src/cli/supervisor-runtime.test.ts
npm run build
```
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
- Local dirt besides this work remains the pre-existing untracked `.codex-supervisor/replay/` directory.
- The three CodeRabbit comments were all valid against the checked-out code; no rejection response is needed.
- The final remaining CodeRabbit thread was also valid against `7c8fb28`: a stop signal during `server.listen()` could be consumed before `stopWebServer` existed, leaving the WebUI process running.
- Draft PR: https://github.com/TommyKammy/codex-supervisor/pull/795
- Updated at: 2026-03-21T18:35:21Z
