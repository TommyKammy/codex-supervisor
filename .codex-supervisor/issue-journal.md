# Issue #785: WebUI MVP: ship a read-only operator dashboard backed only by HTTP and SSE

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/785
- Branch: codex/issue-785
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 3 (implementation=2, repair=1)
- Last head SHA: 3e46f8bbf22cd94b0eca21b858297c443badbfaa
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ8515skc|PRRT_kwDORgvdZ8515skh|PRRT_kwDORgvdZ8515skm
- Repeated failure signature count: 1
- Updated at: 2026-03-21T18:22:53Z

## Latest Codex Summary
Addressed the three open automated review threads on PR #795, committed the fixes as `3e46f8b`, and pushed `codex/issue-785`. In the dashboard, `loadIssue()` now clears prior issue data, shows loading placeholders, and ignores stale async responses so the selected badge cannot drift from the explain/lint panes; the SSE badge now stays in `connecting` until the browser receives the EventSource `open` event. In the CLI runtime, WebUI shutdown now calls `server.closeAllConnections?.()` before `server.close()` so an active `/api/events` subscriber cannot keep shutdown pending.

I added focused regression coverage for the shutdown order and re-ran the WebUI server/runtime tests plus a full build. The only local dirt is this journal update, the review-fix code changes, and the pre-existing untracked `.codex-supervisor/replay/` directory.

Summary: Fixed the three PR review issues, added focused shutdown coverage, and pushed commit `3e46f8b` to PR #795.
State hint: addressing_review
Blocked reason: none
Tests: `npx tsx --test src/cli/supervisor-runtime.test.ts`; `npm run build`; `npx tsx --test src/backend/supervisor-http-server.test.ts src/cli/supervisor-runtime.test.ts`
Failure signature: none
Next action: Update/respond on PR #795 review threads and continue the remaining manual browser verification gap

## Active Failure Context
- Category: review
- Summary: 3 unresolved automated review thread(s) remain.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/795#discussion_r2969922167
- Details:
  - src/backend/webui-dashboard.ts:569 _⚠️ Potential issue_ | _🟠 Major_ **Guard `loadIssue()` against stale responses.** `loadIssue()` updates the selected badge before the fetch, then blindly commits the response afterward. If a slower prior request finishes late—or the new request fails—the badge can point at one issue while the explain/lint panes still show another. <details> <summary>🩹 Possible fix</summary> ```diff async function loadIssue(issueNumber) { state.selectedIssueNumber = issueNumber; + state.explain = null; + state.issueLint = null; renderSelectedIssue(); + setText(elements.issueSummary, "Loading issue..."); + setCode(elements.issueExplain, "Loading /api/issues/:issueNumber/explain..."); + setCode(elements.issueLint, "Loading /api/issues/:issueNumber/issue-lint..."); const [explain, issueLint] = await Promise.all([ readJson("/api/issues/" + issueNumber + "/explain"), readJson("/api/issues/" + issueNumber + "/issue-lint"), ]); + if (state.selectedIssueNumber !== issueNumber) { + return; + } state.explain = explain; state.issueLint = issueLint; renderIssue(); ``` </details> <details> <summary>🤖 Prompt for AI Agents</summary> ``` Verify each finding against the current code and only fix it if needed. In `@src/backend/webui-dashboard.ts` around lines 559 - 569, The loadIssue function sets state.selectedIssueNumber and renders immediately, but then unconditionally applies async results from readJson which can be stale; modify loadIssue to capture the requested issueNumber (e.g., const requested = issueNumber) or read back state.selectedIssueNumber before applying results, and only assign state.explain, state.issueLint and call renderIssue()/markRefresh() if the current selected issue still equals requested; also handle errors by avoiding state mutation (or reverting) when the selected issue has changed so the badge and panes remain consistent (references: loadIssue, state.selectedIssueNumber, renderSelectedIssue, renderIssue, markRefresh, readJson). ``` </details> <!-- fingerprinting:phantom:medusa:grasshopper --> <!-- This is an auto-generated comment by CodeRabbit -->
  - src/backend/webui-dashboard.ts:584 _⚠️ Potential issue_ | _🟡 Minor_ **Keep the connection badge in `connecting` until the stream actually opens.** The page already has an `open` listener, but Line 580 flips the badge to `open` immediately. On an initial connect failure, the UI briefly reports a healthy stream that never opened. <details> <summary>🔧 Minimal fix</summary> ```diff function wireEvents() { const source = new EventSource("/api/events"); - setText(elements.connectionState, "open"); source.addEventListener("open", () => { setText(elements.connectionState, "open"); }); ``` </details> <details> <summary>🤖 Prompt for AI Agents</summary> ``` Verify each finding against the current code and only fix it if needed. In `@src/backend/webui-dashboard.ts` around lines 578 - 584, The connection badge is set to "open" immediately inside wireEvents which misreports state before the EventSource actually opens; change the initial call setText(elements.connectionState, "open") to setText(elements.connectionState, "connecting") (or remove it) so the badge remains "connecting" until the source.addEventListener("open", ...) sets it to "open" — update the wireEvents function and any related initialization of the source/EventSource variable to use "connecting" and rely on the existing source.addEventListener("open", ...) to flip to "open". ``` </details> <!-- fingerprinting:phantom:medusa:grasshopper --> <!-- This is an auto-generated comment by CodeRabbit -->
  - src/cli/supervisor-runtime.ts:43 _⚠️ Potential issue_ | _🟠 Major_ <details> <summary>🧩 Analysis chain</summary> 🌐 Web query: `In Node.js, does http.Server.close() wait for active Server-Sent Events (SSE) connections to end before invoking its callback, and is the server "close" event emitted only after those connections have closed?` 💡 Result: - `http.Server.close([callback])` **stops accepting new connections immediately**, but it **does not terminate active HTTP responses**—it only “closes all connections … which are *not* sending a request or *waiting for a response*” (and, since Node.js v19, it also proactively closes *idle* keep-alive connections). An SSE connection is typically “waiting for a response” indefinitely, so it will **keep the server from fully closing until that SSE connection ends** (or you explicitly end/destroy it). [1] - The actual “wait” behavior comes from `net.Server.close()`: the server is “finally closed when **all connections are ended** and the server emits a `'close'` event,” and the **optional callback is invoked once that `'close'` event occurs**. Therefore, **both the `close()` callback and the server’s `'close'` event happen only after your SSE sockets have closed**. [2] **Sources:** [1] Node.js HTTP docs (`server.close([callback])`) ([nodejs.org](https://nodejs.org/download/nightly/v26.0.0-nightly2026022776215dc993/docs/api/http.html)) [2] Node.js net docs (`server.close([callback])` / `'close'` event semantics) ([r2.nodejs.org](https://r2.nodejs.org/docs/latest-v10.x/api/net.html?utm_source=openai)) Citations: - 1: https://nodejs.org/download/nightly/v26.0.0-nightly2026022776215dc993/docs/api/http.html - 2: https://r2.nodejs.org/docs/latest-v10.x/api/net.html?utm_source=openai --- </details> **WebUI shutdown will hang when `/api/events` has active subscribers.** Node.js `http.Server.close()` does not terminate active HTTP responses—it only waits for all connections to end before invoking its callback. SSE clients remain "waiting for a response" indefinitely, so `server.close()` will block and never fire `"close"` event or its callback, leaving `runSupervisorCommand("web")` stuck on SIGINT/SIGTERM. Close long-lived connections eagerly before invoking `close()`, or expose an explicit shutdown hook for the injected server. Call `server.closeAllConnections?.()` before `server.close(callback)` to proactively tear down SSE sockets. Add a regression test with an open `/api/events` client to prevent re-introduction. <details> <summary>🤖 Prompt for AI Agents</summary> ``` Verify each finding against the current code and only fix it if needed. In `@src/cli/supervisor-runtime.ts` around lines 38 - 43, The WebUI shutdown hangs because the injected server's close() waits for active SSE responses; update the supervisor shutdown logic that calls createHttpServer (referencing createHttpServer and SupervisorService) to proactively tear down long-lived connections by invoking server.closeAllConnections?.() (or an exposed shutdown hook) before calling server.close(callback); ensure the code checks for closeAllConnections existence and falls back safely, then add a regression test that opens an SSE client against /api/events, sends SIGINT/SIGTERM to the process, and asserts the shutdown completes (no hang) to prevent regressions. ``` </details> <!-- fingerprinting:phantom:medusa:grasshopper --> <!-- This is an auto-generated comment by CodeRabbit -->

## Codex Working Notes
### Current Handoff
- Hypothesis: the remaining review risk is local state drift around async issue loads and WebUI shutdown behavior, so the right fix is to keep the browser state pessimistic during issue fetches and explicitly tear down long-lived HTTP connections before waiting on server close.
- What changed: updated `src/backend/webui-dashboard.ts` so issue selection clears old explain/lint data, renders loading placeholders, and ignores stale async responses; changed the SSE badge to remain `connecting` until EventSource emits `open`; updated `src/cli/supervisor-runtime.ts` to call `closeAllConnections?.()` before `close()`; added a focused runtime regression test covering that shutdown order.
- Current blocker: none
- Next exact step: update PR #795 review threads to point at `3e46f8b`, then return to the remaining manual browser verification gap.
- Verification gap: automated verification for the review fixes passed; the only remaining gap from the broader issue is still a real browser pass with a live emitted SSE event.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/backend/supervisor-http-server.ts`, `src/backend/supervisor-http-server.test.ts`, `src/backend/webui-dashboard.ts`, `src/cli/entrypoint.test.ts`, `src/cli/parse-args.test.ts`, `src/cli/parse-args.ts`, `src/cli/supervisor-runtime.test.ts`, `src/cli/supervisor-runtime.ts`, `src/core/types.ts`
- Rollback concern: keep the dashboard thin and transport-driven; avoid pulling supervisor state interpretation or mutation workflows into the browser, and avoid coupling the UI to local files outside the existing HTTP/SSE surface.
- Last focused command: `npx tsx --test src/backend/supervisor-http-server.test.ts src/cli/supervisor-runtime.test.ts`
- Last focused failure: none
- Last focused commands:
```bash
npx tsx --test src/cli/supervisor-runtime.test.ts
npm run build
npx tsx --test src/backend/supervisor-http-server.test.ts src/cli/supervisor-runtime.test.ts
```
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
- Local dirt besides this work remains the pre-existing untracked `.codex-supervisor/replay/` directory.
- The three CodeRabbit comments were all valid against the checked-out code; no rejection response is needed.
- Draft PR: https://github.com/TommyKammy/codex-supervisor/pull/795
- Updated at: 2026-03-21T18:22:53Z
