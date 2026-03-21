# Issue #783: Backend adapter MVP: add a read-only HTTP API over SupervisorService

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/783
- Branch: codex/issue-783
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 4c74dea9950fad79c54c3dc266106ec5f51d42e7
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-21T15:54:52.116Z

## Latest Codex Summary
- None yet.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the missing work for issue #783 was a thin transport adapter, not new supervisor domain logic. A standalone HTTP server over `SupervisorService` should satisfy the MVP without touching CLI behavior.
- What changed: added `src/backend/supervisor-http-server.ts` with read-only `GET /api/status`, `GET /api/doctor`, `GET /api/issues/:issueNumber/explain`, and `GET /api/issues/:issueNumber/issue-lint` routes that serialize the existing DTOs directly to JSON, plus minimal 400/404/405 JSON error responses. Added `src/backend/supervisor-http-server.test.ts` to reproduce the missing adapter first, then verify representative JSON responses for all four endpoints against a stub `SupervisorService`.
- Current blocker: none
- Next exact step: monitor draft PR #793 for CI and any review feedback, then wire this adapter into the eventual WebUI backend startup path in a follow-up slice.
- Verification gap: local verification covered the new adapter test plus `npm run build`; broader runtime wiring for starting the HTTP server is still out of scope for this slice.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/backend/supervisor-http-server.test.ts`, `src/backend/supervisor-http-server.ts`
- Rollback concern: replacing this adapter with transport-specific domain logic would duplicate `SupervisorService` behavior and undermine the WebUI boundary this issue is meant to establish.
- Last focused command: `npm run build`
- Last focused failure: initial reproducer failed with `MODULE_NOT_FOUND` for `./supervisor-http-server`; later `npm run build` failed until `npm ci` installed `tsc`, and a test fixture was corrected to satisfy `DoctorDiagnostics.candidateDiscoverySummary: string`.
- Last focused commands:
```bash
npx tsx --test src/backend/supervisor-http-server.test.ts
npm ci
npm run build
```
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
- Reproducer-first note: `src/backend/supervisor-http-server.test.ts` initially failed on missing module, then passed after the adapter landed.
- Updated at: 2026-03-21T16:00:33Z
