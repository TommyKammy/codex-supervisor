# Issue #1237: [codex] Route setup and dashboard local CI flows through shared browser helpers

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1237
- Branch: codex/issue-1237
- Workspace: .
- Journal: .codex-supervisor/issues/1237/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 078fa3c6cbfb048a2f1add3c4d8d0ae7537f6729
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-31T02:11:29.176Z

## Latest Codex Summary
- Extracted shared browser-side local CI helpers and routed setup/dashboard local CI rendering through them while preserving existing operator-visible behavior.
- Added focused helper tests for advisory/configured local CI contract formatting and re-ran the setup/dashboard backend browser regressions.
- `npm run build` remains blocked in this workspace because the build script expects `tsc` on PATH, but `node_modules/.bin/tsc` is absent.
- Created draft PR #1239 and then merged `github/main` into the branch after GitHub reported `mergeable_state: dirty`; resolved the browser-helper conflicts against the newer shared helper module on main.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: Setup and dashboard local CI behavior can move behind a shared browser helper boundary without changing rendered copy or save/revalidate flows.
- What changed: Added `src/backend/webui-local-ci-browser-helpers.ts` plus helper tests as a compatibility layer, then resolved the base-branch merge by adopting the newer canonical `src/backend/webui-browser-script-helpers.ts` boundary from `main` for both setup and dashboard browser scripts while keeping the focused local CI helper coverage.
- Current blocker: `npm run build` still cannot complete in this workspace because `tsc` is not installed locally (`node_modules/.bin/tsc` missing), so the build script exits before typechecking.
- Next exact step: Commit the merge-resolution checkpoint, push `codex/issue-1237`, and let PR #1239 re-evaluate mergeability/CI; rerun `npm run build` only in an environment with installed dependencies.
- Verification gap: Full `npm run build` remains unverified in this workspace for the same missing-local-TypeScript reason.
- Files touched: `.codex-supervisor/issues/1237/issue-journal.md`, `src/backend/webui-dashboard-browser-logic.ts`, `src/backend/webui-dashboard-browser-script.ts`, `src/backend/webui-setup-browser-script.ts`, `src/backend/webui-local-ci-browser-helpers.ts`, `src/backend/webui-local-ci-browser-helpers.test.ts`, plus merged base-branch helper/test files from `github/main`.
- Rollback concern: Low; the main risk is browser inline helper injection drifting from the canonical helper module if future refactors reintroduce imported helper references into serialized function bodies.
- Last focused command: `npx tsx --test src/backend/webui-browser-script-helpers.test.ts src/backend/webui-local-ci-browser-helpers.test.ts src/backend/webui-dashboard.test.ts src/backend/supervisor-http-server.test.ts`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
