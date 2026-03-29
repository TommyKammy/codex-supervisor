# Issue #1180: Serialize Web run-once behind the supervisor cycle lock

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1180
- Branch: codex/issue-1180
- Workspace: .
- Journal: .codex-supervisor/issues/1180/issue-journal.md
- Current phase: repairing_ci
- Attempt count: 3 (implementation=2, repair=1)
- Last head SHA: 6daaeb1beee0728c69c74467d00c56918368c14d
- Blocked reason: none
- Last failure signature: build (ubuntu-latest):fail|build (macos-latest):fail
- Repeated failure signature count: 1
- Updated at: 2026-03-29T09:18:54.246Z

## Latest Codex Summary
Pushed `codex/issue-1180` and opened draft PR [#1181](https://github.com/TommyKammy/codex-supervisor/pull/1181). I also updated the issue journal handoff to reflect the pushed branch and PR state, then committed that journal update as `6daaeb1`.

Summary: Draft PR #1181 is open for the Web `run-once` cycle-lock fix, and the issue journal handoff is updated and pushed.
State hint: draft_pr
Blocked reason: none
Tests: Not rerun this turn; no code changes beyond journal/PR state. Prior focused verification remained: `npx tsx --test src/backend/supervisor-http-server.test.ts`; `npx tsx --test src/supervisor/supervisor-loop-controller.test.ts`; `npx tsx --test src/supervisor/supervisor-diagnostics-status-selection.test.ts`; `npx tsx --test src/cli/supervisor-runtime.test.ts`; `npx tsx --test src/cli/entrypoint.test.ts`
Next action: Monitor draft PR #1181 for CI or review feedback and address any follow-up if it appears.
Failure signature: build (ubuntu-latest):fail|build (macos-latest):fail

## Active Failure Context
- Category: checks
- Summary: PR #1181 has failing checks.
- Command or source: gh pr checks
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/1181
- Details:
  - build (ubuntu-latest) (fail/FAILURE) https://github.com/TommyKammy/codex-supervisor/actions/runs/23705848015/job/69057516996
  - build (macos-latest) (fail/FAILURE) https://github.com/TommyKammy/codex-supervisor/actions/runs/23705848015/job/69057517000

## Codex Working Notes
### Current Handoff
- Hypothesis: PR #1181's failing `build` jobs were caused by the new concurrent Web `run-once` test using a stubbed `runOnce` signature that no longer matched `SupervisorService["runOnce"]`, plus nullable callback gates that `tsc` inferred as non-callable in strict compilation.
- What changed: Added optional `loopController` wiring to the HTTP server, switched Web `run-once` to `loopController.runCycle("run-once", ...)`, required a loop controller for `web` runtime startup, added focused tests for concurrent Web `run-once` requests plus runtime/entrypoint wiring, then repaired the HTTP server concurrency test by typing the stubbed `runOnce` parameter as `Parameters<SupervisorService["runOnce"]>[0]` and replacing nullable gate callbacks with definite-assignment callbacks so `npm run build` passes.
- Current blocker: none
- Next exact step: Commit the test-only CI repair on `codex/issue-1180`, push the branch, and recheck PR #1181 checks.
- Verification gap: none for the focused issue verification set.
- Files touched: .codex-supervisor/issues/1180/issue-journal.md, src/backend/supervisor-http-server.ts, src/backend/supervisor-http-server.test.ts, src/cli/supervisor-runtime.ts, src/cli/supervisor-runtime.test.ts, src/cli/entrypoint.ts, src/cli/entrypoint.test.ts
- Rollback concern: The WebUI `run-once` endpoint now fails closed if the server is constructed without a loop controller; runtime wiring was updated so normal `web` startup still provides one.
- Last focused command: npm run build
### Scratchpad
- `gh run view 23705848015 --log-failed` showed the shared failure on both runners: `src/backend/supervisor-http-server.test.ts(1145,21): error TS7006` / earlier `TS2554` for a mismatched `runOnce` stub argument and `src/backend/supervisor-http-server.test.ts(1210,3): error TS2349` from the nullable release callback.
- Local verification after the repair: `npm run build`; `npx tsx --test src/backend/supervisor-http-server.test.ts`; `npx tsx --test src/supervisor/supervisor-loop-controller.test.ts`; `npx tsx --test src/supervisor/supervisor-diagnostics-status-selection.test.ts`; `npx tsx --test src/cli/supervisor-runtime.test.ts src/cli/entrypoint.test.ts`
