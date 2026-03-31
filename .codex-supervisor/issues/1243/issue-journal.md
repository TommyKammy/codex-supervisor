# Issue #1243: [codex] Add structured execution mode for localCiCommand

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1243
- Branch: codex/issue-1243
- Workspace: .
- Journal: .codex-supervisor/issues/1243/issue-journal.md
- Current phase: stabilizing
- Attempt count: 2 (implementation=2, repair=0)
- Last head SHA: b24c46af34310d1b36a1942bde36844a69d67931
- Blocked reason: none
- Last failure signature: local-build-missing-tsc
- Repeated failure signature count: 1
- Updated at: 2026-03-31T04:09:19.585Z

## Latest Codex Summary
Restored the missing workspace toolchain with `npm ci`, fixed the TypeScript callers that the full build surfaced, and reran verification successfully.

Structured `localCiCommand` support remains as implemented in `b24c46a`, with:
- legacy string values on the compatibility shell path
- `mode: "structured"` for executable-plus-args execution without shell parsing
- `mode: "shell"` for explicit shell execution

Stabilization changes:
- added a proper type guard in `src/local-ci.ts` so the union type compiles under `tsc`
- updated broader supervisor tests to include the required `execution_mode` field on `LatestLocalCiResult`

Verification passed:
- `npm ci`
- `npm run build`
- `npx tsx --test src/local-ci.test.ts src/post-turn-pull-request.test.ts src/turn-execution-publication-gate.test.ts src/config.test.ts src/doctor.test.ts`

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: `localCiCommand` should support a non-shell structured path for repo-owned entrypoints while leaving shell execution explicit and observable.
- What changed: Restored the workspace toolchain with `npm ci`, fixed `src/local-ci.ts` type narrowing for `tsc`, and updated supervisor tests that construct `LatestLocalCiResult` to include `execution_mode`.
- Current blocker: none.
- Next exact step: Commit the stabilization fixes on top of `b24c46a` and decide whether to open/update the draft PR from this verified checkpoint.
- Verification gap: No known local verification gap after `npm run build` and the focused regression suite passed.
- Files touched: src/core/types.ts; src/core/config.ts; src/local-ci.ts; src/setup-config-write.ts; src/setup-readiness.ts; src/local-ci.test.ts; src/config.test.ts; src/post-turn-pull-request.test.ts; src/doctor.test.ts; src/supervisor/supervisor-cycle-snapshot.test.ts; src/supervisor/supervisor-diagnostics-status-selection.test.ts; src/supervisor/supervisor-operator-activity-context.test.ts; src/supervisor/supervisor-selection-issue-explain.test.ts
- Rollback concern: Setup/WebUI surfaces still only write string `localCiCommand` values; structured commands are supported when hand-authored in config, so future UI work should avoid overwriting object configs accidentally.
- Last focused command: npm run build
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
