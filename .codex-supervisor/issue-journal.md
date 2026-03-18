# Issue #525: Local review abstraction: support fake-runner focused tests for reviewer and verifier orchestration

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/525
- Branch: codex/issue-525
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 9729b5217558af604a957dabbbf7321798e0318c
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-18T05:31:39.489Z

## Latest Codex Summary
Focused local-review orchestration coverage now uses a reusable fake runner instead of depending on a live `codexBinary`. In [src/local-review/test-helpers.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-525/src/local-review/test-helpers.ts), I added `createFakeLocalReviewRunner()`, `createRoleTurnOutput()`, and `createVerifierTurnOutput()` so tests can drive the real runner parsing contract with deterministic role-based outputs. In [src/local-review/execution.test.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-525/src/local-review/execution.test.ts), I added one reviewer-only orchestration test and one reviewer-plus-verifier orchestration test that go through `runLocalReviewExecution()` using `runRoleReview()` and `runVerifierReview()` backed by the fake runner, proving both paths work without using `codexBinary`.

Verification passed with `npx tsx --test src/local-review/runner.test.ts src/local-review/execution.test.ts` and `npm run build`.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the missing leverage point was not product code but test support; focused reviewer/verifier orchestration coverage needed a reusable fake runner that still exercised the real local-review runner parsing path instead of stubbing entire role/verifier functions.
- What changed: added fake local-review runner helpers in `src/local-review/test-helpers.ts` and converted focused orchestration coverage in `src/local-review/execution.test.ts` to drive `runLocalReviewExecution()` through `runRoleReview()` and `runVerifierReview()` with fake runner outputs for both reviewer-only and verifier-triggering paths.
- Current blocker: none
- Next exact step: commit this focused test-only change on `codex/issue-525`, then open or update the draft PR if one does not already exist.
- Verification gap: none for the requested focused tests and build; broader suite was not rerun after the targeted verification.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/local-review/execution.test.ts`, `src/local-review/test-helpers.ts`
- Rollback concern: removing the fake-runner helpers would push focused orchestration tests back toward live CLI dependence or coarse stubs, reducing confidence in reviewer/verifier wiring.
- Last focused command: `npm run build`
### Scratchpad
- 2026-03-18 (JST): Added two narrow repro tests in `src/local-review/execution.test.ts`; initial focused failure was `TypeError: (0 , import_test_helpers.createRoleTurnOutput) is not a function`.
- 2026-03-18 (JST): Implemented `createFakeLocalReviewRunner()`, `createRoleTurnOutput()`, and `createVerifierTurnOutput()` in `src/local-review/test-helpers.ts`; first pass exposed a shape mismatch (`Cannot read properties of undefined (reading 'match')`) because the helper accepted raw strings but did not normalize them into `{ exitCode, rawOutput }`.
- 2026-03-18 (JST): Normalized string outputs inside the fake runner helper; `npx tsx --test src/local-review/execution.test.ts`, `npx tsx --test src/local-review/runner.test.ts src/local-review/execution.test.ts`, and `npm run build` then passed.
