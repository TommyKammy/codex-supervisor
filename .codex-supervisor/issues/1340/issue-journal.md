# Issue #1340: Bug: fail closed when dist runtime is stale relative to source checkout

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1340
- Branch: codex/issue-1340
- Workspace: .
- Journal: .codex-supervisor/issues/1340/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 592794c7cd861c2bee5354b28064213ba46e4a23
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-04-07T14:13:34.872Z

## Latest Codex Summary
- Added a startup freshness guard for `node dist/index.js ...` that compares a build-time source digest manifest against the current checkout and fails closed with an actionable `npm run build` error before CLI service construction.
- Added focused regression coverage for the helper, CLI bootstrap boundary, and compiled `dist/index.js` path, including fresh-build pass and stale-manifest hard-fail behavior.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: A build-time manifest recorded in `dist/` can reliably detect when the checked-out runtime sources advanced after the last `npm run build`, and the CLI should fail before any runtime services are created.
- What changed: Added `src/build-freshness.ts` plus a `postbuild` step that writes `dist/build-manifest.json`; `runCli()` now calls the freshness guard before parsing commands or constructing supervisor services; added focused tests in `src/build-freshness.test.ts`, `src/cli/entrypoint.test.ts`, and `src/build.test.ts`.
- Current blocker: none
- Next exact step: Commit the freshness-guard change set on `codex/issue-1340`, then decide whether to open a draft PR from the checkpoint.
- Verification gap: Full `npm test` still includes unrelated baseline failures outside this issue's scope; focused stale-runtime coverage and `npm run build` are passing.
- Files touched: package.json; src/build-freshness.ts; src/build-freshness.test.ts; src/cli/entrypoint.ts; src/cli/entrypoint.test.ts; src/build.test.ts
- Rollback concern: The guard hashes non-test TypeScript source plus `package.json` and `tsconfig.json`; if future runtime-critical inputs live elsewhere, the manifest input set will need to expand.
- Last focused command: npx tsx --test src/build-freshness.test.ts src/cli/entrypoint.test.ts src/build.test.ts
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
