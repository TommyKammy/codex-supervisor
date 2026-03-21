# Issue #784: Backend adapter MVP: add SSE event streaming over existing supervisor events

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/784
- Branch: codex/issue-784
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 3 (implementation=2, repair=1)
- Last head SHA: 27706c15aaa54305b80a8b6a80b4edb492c439b6
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ8515bGn|PRRT_kwDORgvdZ8515bGs
- Repeated failure signature count: 1
- Updated at: 2026-03-21T17:22:44.476Z

## Latest Codex Summary
Addressed the two CodeRabbit review findings on PR #794 locally. Fresh `/api/events` connections now start at the live edge instead of replaying buffered history, and supervisor event subscribers now fan out asynchronously with isolated error logging so one bad transport listener cannot block the rest. Added focused regression coverage for both behaviors.

Summary: Fixed the SSE replay edge case and isolated subscriber failures, with focused regression tests.
State hint: addressing_review
Blocked reason: none
Tests: `npx tsx --test src/backend/supervisor-http-server.test.ts src/supervisor/supervisor-service.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts src/supervisor/supervisor-execution-orchestration.test.ts`; `npm run build`
Failure signature: none
Next action: Commit and push the review-fix patch to `codex/issue-784`, then update PR #794.

## Active Failure Context
- Category: review
- Summary: Local fixes for the two automated review findings are implemented and verified; PR thread resolution is pending the pushed branch update.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/794#discussion_r2969829475
- Details:
  - `src/backend/supervisor-http-server.ts`: replay now occurs only when `Last-Event-ID` is present, so a first-time `/api/events` connection starts at the live edge.
  - `src/supervisor/supervisor-service.ts`: subscriber delivery now runs through isolated microtasks with `console.error` logging on failure, so later listeners still receive the event.
  - Regression coverage added in `src/backend/supervisor-http-server.test.ts` and `src/supervisor/supervisor-service.test.ts`.

## Codex Working Notes
### Current Handoff
- Hypothesis: the right MVP is still a thin transport adapter. Keep replay buffering and heartbeat in the backend SSE layer while reusing existing `SupervisorEvent` emission from the supervisor domain.
- What changed: applied both CodeRabbit review fixes locally. The SSE adapter no longer replays buffered events on a fresh connection, and service-level event subscribers are now isolated so a thrown listener cannot block sibling subscribers. Added focused regression tests for both paths.
- Current blocker: none
- Next exact step: commit and push the review-fix patch to PR #794, then re-check CI/review state.
- Verification gap: none for the local review fixes; targeted tests and `npm run build` passed after the changes.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/backend/supervisor-http-server.ts`, `src/backend/supervisor-http-server.test.ts`, `src/supervisor/supervisor-service.ts`, `src/supervisor/supervisor-service.test.ts`
- Rollback concern: moving replay state into supervisor domain objects would blur the backend transport boundary and make future WebSocket work harder; keep transport buffering local to the HTTP adapter.
- Last focused command: `npx tsx --test src/backend/supervisor-http-server.test.ts src/supervisor/supervisor-service.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts src/supervisor/supervisor-execution-orchestration.test.ts`
- Last focused failure: none
- Last focused commands:
```bash
npx tsx --test src/backend/supervisor-http-server.test.ts src/supervisor/supervisor-service.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts src/supervisor/supervisor-execution-orchestration.test.ts
npm run build
```
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
- Local dirt besides this work remains the pre-existing untracked `.codex-supervisor/replay/` directory.
- Updated at: 2026-03-22T00:26:00Z
