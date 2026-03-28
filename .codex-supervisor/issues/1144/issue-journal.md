# Issue #1144: Promote fail-closed persisted artifact identity validation before post-merge follow-up promotion

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1144
- Branch: codex/issue-1144
- Workspace: .
- Journal: .codex-supervisor/issues/1144/issue-journal.md
- Current phase: resolving_conflict
- Attempt count: 3 (implementation=2, repair=1)
- Last head SHA: 9f3301e21751f8bff57d39910d4eec0d3e999810
- Blocked reason: none
- Last failure signature: dirty:9f3301e21751f8bff57d39910d4eec0d3e999810
- Repeated failure signature count: 1
- Updated at: 2026-03-28T00:47:05.000Z

## Latest Codex Summary
Merged the latest `github/main` (`a5d6e16`) into `codex/issue-1144`, resolved the two post-merge audit summary conflicts by keeping both the persisted-artifact identity guardrail and the new external-review follow-up promotion path, and reran a broader focused verification pass plus `npm run build`.

The branch is ready for the merge commit/push that clears PR #1147's dirty merge state; the only remaining local tracked change should be this journal update after staging the merge.

Summary: Merged `github/main` into `codex/issue-1144`, resolved post-merge audit summary conflicts, and reran focused verification successfully.
State hint: resolving_conflict
Blocked reason: none
Tests: `npx tsx --test src/supervisor/post-merge-audit-summary.test.ts src/supervisor/post-merge-audit-summary-runtime.test.ts src/external-review/external-review-miss-history.test.ts src/local-review/runner.test.ts src/local-review/repair-context.test.ts src/supervisor/supervisor-diagnostics-guardrail-reporting.test.ts src/backend/webui-dashboard.test.ts src/backend/supervisor-http-server.test.ts src/issue-metadata/issue-metadata-parser.test.ts src/issue-metadata/issue-metadata.test.ts src/run-once-issue-selection.test.ts src/supervisor/supervisor-selection-issue-lint.test.ts`; `npm run build`
Next action: Stage and commit the merge resolution, push `codex/issue-1144`, and confirm PR #1147 is no longer DIRTY.
Failure signature: none

## Active Failure Context
- None recorded. Prior PR #1147 merge-state conflict was resolved locally by merging `github/main` (`a5d6e16`) into `codex/issue-1144`.

## Codex Working Notes
### Current Handoff
- Hypothesis: Persisted artifact promotion was too permissive. Runtime external-review history accepted malformed optional evidence fields, and post-merge audit summarization trusted embedded local-review identity without checking it against the merged context.
- What changed: Added reusable identity/evidence validation helpers, enforced fail-closed validation before promoting persisted external-review miss artifacts, skipped post-merge audit artifacts whose embedded local-review issue/PR/branch/head identity mismatches the authoritative merged context, added focused regression tests, documented the guardrail in `docs/local-review.md`, merged `github/main` at `a5d6e16`, and resolved the resulting conflicts in `src/supervisor/post-merge-audit-summary.ts` and `src/supervisor/post-merge-audit-summary.test.ts` by keeping both the identity guardrail and the external-review follow-up promotion coverage.
- Current blocker: none
- Next exact step: Stage and commit the merge resolution on `codex/issue-1144`, push the branch, and verify PR #1147 no longer reports `mergeStateStatus=DIRTY`.
- Verification gap: Full repo `npm test` still includes unrelated browser-smoke coverage and was not used for this issue; the broader focused suite and `npm run build` passed after the base-branch merge.
- Files touched: docs/local-review.md; src/persisted-artifact-promotion.ts; src/external-review/external-review-miss-artifact.ts; src/external-review/external-review-miss-history.ts; src/external-review/external-review-miss-history.test.ts; src/local-review/repair-context.ts; src/local-review/runner.ts; src/supervisor/post-merge-audit-summary.ts; src/supervisor/post-merge-audit-summary.test.ts; src/supervisor/supervisor-status-rendering.ts
- Rollback concern: Tightened validation now skips malformed or mismatched persisted artifacts instead of promoting them; if older artifacts relied on permissive parsing, operator-facing summaries may surface fewer historical runtime hints until those artifacts are regenerated.
- Last focused commands: `git fetch github main`; `git fetch origin main`; `git merge --no-ff github/main`; `npx tsx --test src/supervisor/post-merge-audit-summary.test.ts src/supervisor/post-merge-audit-summary-runtime.test.ts src/external-review/external-review-miss-history.test.ts src/local-review/runner.test.ts src/local-review/repair-context.test.ts src/supervisor/supervisor-diagnostics-guardrail-reporting.test.ts src/backend/webui-dashboard.test.ts src/backend/supervisor-http-server.test.ts src/issue-metadata/issue-metadata-parser.test.ts src/issue-metadata/issue-metadata.test.ts src/run-once-issue-selection.test.ts src/supervisor/supervisor-selection-issue-lint.test.ts`; `npm run build`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
