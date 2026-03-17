# Issue #462: Test refactor: split external-review miss tests by normalization and durable-guardrail coverage

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/462
- Branch: codex/issue-462
- Workspace: /home/tommy/Dev/codex-supervisor-self-worktrees/issue-462
- Journal: /home/tommy/Dev/codex-supervisor-self-worktrees/issue-462/.codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 9f566dee933873fd345c89c4a3a7a0fea426ed9d
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-17T08:27:30Z

## Latest Codex Summary
- Split the monolithic external-review misses suite into focused normalization, classifier, persistence, and miss-history test files; removed the old combined test file after preserving its assertions.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: The external-review miss coverage is easier to maintain when assertions live beside the normalization, classifier, persistence, and miss-history module seams instead of a single shared suite.
- What changed: Added `external-review-normalization.test.ts`, `external-review-classifier.test.ts`, `external-review-miss-persistence.test.ts`, and `external-review-miss-history.test.ts`; moved the existing assertions into those files with local fixtures and deleted `external-review-misses.test.ts`.
- Current blocker: none
- Next exact step: Commit the extracted test suites on `codex/issue-462` and open or update the draft PR if needed.
- Verification gap: none for the requested external-review normalization, misses, guardrail-loading, and build checks after `npm ci` restored missing local dependencies.
- Files touched: src/external-review/external-review-normalization.test.ts; src/external-review/external-review-classifier.test.ts; src/external-review/external-review-miss-persistence.test.ts; src/external-review/external-review-miss-history.test.ts; src/external-review/external-review-misses.test.ts; .codex-supervisor/issue-journal.md
- Rollback concern: The new suites intentionally duplicate a few tiny fixture builders to keep module-local coverage independent; collapsing them back into a shared helper would reintroduce cross-file coupling and blur the boundaries this issue is trying to restore.
- Last focused command: npm run build
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
- Reproducing signature before the fix: `external-review-misses.test.ts` mixed normalization, matching, persistence, and durable guardrail loading in one 22-test file, so edits and failures crossed module boundaries.
- Verification commands: `npx tsx --test src/external-review/external-review-normalization.test.ts`; `npx tsx --test src/external-review/external-review-classifier.test.ts`; `npx tsx --test src/external-review/external-review-miss-persistence.test.ts`; `npx tsx --test src/external-review/external-review-miss-history.test.ts`; `npx tsx --test src/external-review/*.test.ts`; `npm ci`; `npm run build`.
