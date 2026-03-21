# Issue #782: WebUI prep: split loop process control from supervisor application service

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/782
- Branch: codex/issue-782
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: a1365c8da31e672c0c6f56875bbad5b5fdf8cf7e
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-21T15:18:14Z

## Latest Codex Summary
- Split loop process control into a dedicated `SupervisorLoopController` boundary, removed lock acquisition from `SupervisorService`, rewired the CLI runtime/entrypoint seam, and passed the targeted CLI tests plus `npm run build`.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the remaining WebUI-prep coupling was `SupervisorService.acquireSupervisorLock()`, because the shared service boundary still exposed process/runtime control that only the CLI loop should own.
- What changed: added `src/supervisor/supervisor-loop-controller.ts` with a thin `SupervisorLoopController.runCycle()` wrapper around supervisor lock + `runOnce`, removed `acquireSupervisorLock()` from `SupervisorService`, exported the new factory from `src/supervisor/index.ts`, updated `src/cli/supervisor-runtime.ts` so `loop` and `run-once` use the dedicated loop controller while query/mutation commands keep using the shared service, updated `src/cli/entrypoint.ts` to inject the loop controller only for `loop`/`run-once`, and tightened `src/cli/entrypoint.test.ts`, `src/cli/supervisor-runtime.test.ts`, and `src/supervisor/supervisor.test.ts` to make the separation explicit.
- Current blocker: none
- Next exact step: commit the loop-controller split on `codex/issue-782`, then open or update a draft PR from this branch if one does not already exist.
- Verification gap: none for the requested local scope after installing repo dependencies with `npm ci`; `.codex-supervisor/replay/` remains untracked and untouched.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/cli/entrypoint.test.ts`, `src/cli/entrypoint.ts`, `src/cli/supervisor-runtime.test.ts`, `src/cli/supervisor-runtime.ts`, `src/supervisor/index.ts`, `src/supervisor/supervisor-loop-controller.ts`, `src/supervisor/supervisor-service.ts`, `src/supervisor/supervisor.test.ts`
- Rollback concern: putting lock/process control back on `SupervisorService` would re-couple the shared application boundary to CLI runtime orchestration, which is exactly what the WebUI transport needs to avoid.
- Last focused command: `npm run build`
- Last focused failure: `npm run build` initially failed with `sh: 1: tsc: not found` because `node_modules/` was missing; `npm ci` fixed the environment, after which the build surfaced and I fixed stale `acquireSupervisorLock` test doubles in `src/cli/supervisor-runtime.test.ts`.
- Last focused commands:
```bash
npx tsx --test src/cli/entrypoint.test.ts
npx tsx --test src/cli/supervisor-runtime.test.ts src/cli/entrypoint.test.ts
npm ci
npm run build
```
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
