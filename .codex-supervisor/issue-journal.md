# Issue #786: Backend commands MVP: expose only existing safe supervisor mutations over HTTP

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/786
- Branch: codex/issue-786
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 5b75cfea9cd30cb86996d6e0c0ffcb86a88fec16
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-21T19:11:50.732Z

## Latest Codex Summary
- Added a focused backend reproducer for the missing HTTP mutation surface, then implemented a strict `POST /api/commands/*` allowlist for `run-once`, `requeue`, `prune-orphaned-workspaces`, and `reset-corrupt-json-state`.
- The HTTP server now forwards directly to the existing supervisor service methods, preserves unknown-command rejection and method gating, and returns structured JSON DTOs instead of relying on CLI-rendered strings.
- Focused verification passed with `npx tsx --test src/backend/supervisor-http-server.test.ts`, `npx tsx --test src/cli/supervisor-runtime.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts`, and `npm run build` after restoring local dev dependencies with `npm ci`.

## Active Failure Context
- Category: none
- Summary: none
- Reference: none
- Details:
  - Reproduction initially failed because the backend HTTP server only accepted `GET` requests and returned `405 Method not allowed` for `POST /api/commands/run-once`.
  - The focused reproducer now passes after adding the safe command endpoints and leaving non-allowlisted commands fail-closed with `404`.

## Codex Working Notes
### Current Handoff
- Hypothesis: the missing work for issue #786 was still the backend mutation surface itself, specifically exposing only the pre-existing safe supervisor commands over HTTP without widening authority.
- What changed: added a focused backend test covering representative command success and rejection cases; implemented `POST /api/commands/run-once`, `POST /api/commands/requeue`, `POST /api/commands/prune-orphaned-workspaces`, and `POST /api/commands/reset-corrupt-json-state`; added request JSON parsing with `400` for malformed bodies; updated the dashboard copy to reflect the new limited command transport.
- Current blocker: none
- Next exact step: monitor draft PR #796 for review feedback, with particular attention to whether `run-once` should keep its lightweight structured wrapper or move to a shared DTO type.
- Verification gap: no known local automated gap for this slice; browser-level manual exercise remains optional if the PR review wants it.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/backend/supervisor-http-server.ts`, `src/backend/supervisor-http-server.test.ts`, `src/backend/webui-dashboard.ts`
- Rollback concern: keep the HTTP command surface narrow and transport-level only; do not add loop control or any new mutation authority before the backend/UI MVP is stabilized.
- Last focused command: `npm run build`
- Last focused failure: `POST /api/commands/run-once -> 405 Method not allowed`
- Last focused commands:
```bash
npm ci
npx tsx --test src/backend/supervisor-http-server.test.ts
npx tsx --test src/cli/supervisor-runtime.test.ts
npx tsx --test src/supervisor/supervisor-diagnostics-status-selection.test.ts
npm run build
```
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
- Local dirt besides this work remains the pre-existing untracked `.codex-supervisor/replay/` directory.
- `npm ci` was required locally because `npm run build` initially failed with `sh: 1: tsc: not found`.
- The new backend tests cover the intended allowlist and keep `loop` blocked at the HTTP layer with `404`.
- Draft PR: https://github.com/TommyKammy/codex-supervisor/pull/796
- Updated at: 2026-03-21T19:16:31Z
