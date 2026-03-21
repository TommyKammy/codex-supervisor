# Issue #785: WebUI MVP: ship a read-only operator dashboard backed only by HTTP and SSE

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/785
- Branch: codex/issue-785
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 0bd9c67c49bf57d75e1ec6cae4098020ef4a2757
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-21T17:47:52.843Z

## Latest Codex Summary
- None yet.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the MVP can stay self-contained inside the existing Node HTTP server by serving a static read-only dashboard shell from `/` and reusing the existing `/api/status`, `/api/doctor`, `/api/issues/:issueNumber/(explain|issue-lint)`, and `/api/events` adapters without adding browser mutations or filesystem access.
- What changed: added a server-hosted WebUI shell at `/` that fetches status and doctor summaries, loads explain and issue-lint details for a selected issue, and tails live SSE events. Added a new `web` CLI command to host the read-only dashboard, plus focused tests for the dashboard route and runtime wiring.
- Current blocker: none
- Next exact step: commit the WebUI MVP checkpoint, then open or update the draft PR for issue #785 and verify the `web` command manually against a local config.
- Verification gap: manual browser verification of the new dashboard route and SSE feed is still pending in this workspace.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/backend/supervisor-http-server.ts`, `src/backend/supervisor-http-server.test.ts`, `src/backend/webui-dashboard.ts`, `src/cli/entrypoint.test.ts`, `src/cli/parse-args.test.ts`, `src/cli/parse-args.ts`, `src/cli/supervisor-runtime.test.ts`, `src/cli/supervisor-runtime.ts`, `src/core/types.ts`
- Rollback concern: keep the dashboard thin and transport-driven; avoid pulling supervisor state interpretation or mutation workflows into the browser, and avoid coupling the UI to local files outside the existing HTTP/SSE surface.
- Last focused command: `npx tsx --test src/backend/supervisor-http-server.test.ts src/cli/parse-args.test.ts src/cli/entrypoint.test.ts src/cli/supervisor-runtime.test.ts`
- Last focused failure: none
- Last focused commands:
```bash
npx tsx --test src/backend/supervisor-http-server.test.ts
npx tsx --test src/cli/parse-args.test.ts src/cli/entrypoint.test.ts
npx tsx --test src/backend/supervisor-http-server.test.ts src/cli/parse-args.test.ts src/cli/entrypoint.test.ts src/cli/supervisor-runtime.test.ts
npm ci
npm run build
```
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
- Local dirt besides this work remains the pre-existing untracked `.codex-supervisor/replay/` directory.
- `npm run build` initially failed because local dependencies were missing (`tsc: not found`); `npm ci` fixed the workspace and the subsequent build passed.
- Updated at: 2026-03-21T17:56:05Z
