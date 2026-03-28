# Issue #1144: Promote fail-closed persisted artifact identity validation before post-merge follow-up promotion

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1144
- Branch: codex/issue-1144
- Workspace: .
- Journal: .codex-supervisor/issues/1144/issue-journal.md
- Current phase: addressing_review
- Attempt count: 4 (implementation=2, repair=2)
- Last head SHA: 6265d3b5667e1a9c79b7c552bc97091167ed87c0
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ853abCv
- Repeated failure signature count: 1
- Updated at: 2026-03-28T00:56:11.351Z

## Latest Codex Summary
Merged `github/main` at `a5d6e16` into `codex/issue-1144`, resolved the overlap in [post-merge-audit-summary.ts](src/supervisor/post-merge-audit-summary.ts) and [post-merge-audit-summary.test.ts](src/supervisor/post-merge-audit-summary.test.ts) by keeping both the persisted-artifact identity guardrail and the external-review follow-up promotion path, and updated [issue-journal.md](.codex-supervisor/issues/1144/issue-journal.md). The merge commit is `6265d3b` and it has been pushed to `github/codex/issue-1144`.

The broader focused verification pass and `npm run build` both passed. GitHub now reports PR `#1147` as `mergeable: true`, so the previous DIRTY merge state is cleared. Local status is clean except for untracked supervisor scratch files under `.codex-supervisor/`.

Summary: Merged `github/main` into `codex/issue-1144`, resolved post-merge audit summary conflicts, reran focused verification, and pushed the updated branch.
State hint: resolving_conflict
Blocked reason: none
Tests: `npx tsx --test src/supervisor/post-merge-audit-summary.test.ts src/supervisor/post-merge-audit-summary-runtime.test.ts src/external-review/external-review-miss-history.test.ts src/local-review/runner.test.ts src/local-review/repair-context.test.ts src/supervisor/supervisor-diagnostics-guardrail-reporting.test.ts src/backend/webui-dashboard.test.ts src/backend/supervisor-http-server.test.ts src/issue-metadata/issue-metadata-parser.test.ts src/issue-metadata/issue-metadata.test.ts src/run-once-issue-selection.test.ts src/supervisor/supervisor-selection-issue-lint.test.ts`; `npm run build`
Next action: Monitor PR #1147 CI/review feedback and address any follow-up fixes on `codex/issue-1144` if needed.
Failure signature: PRRT_kwDORgvdZ853abCv

## Active Failure Context
- Category: review
- Summary: 1 unresolved automated review thread(s) remain.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/1147#discussion_r3003835932
- Details:
  - src/external-review/external-review-miss-artifact.ts:86 summary=_⚠️ Potential issue_ | _🟡 Minor_ **Provenance `issueNumber`/`prNumber` should validate as positive integers.** The current validation accepts 0 or negative values, but GitHub i... url=https://github.com/TommyKammy/codex-supervisor/pull/1147#discussion_r3003835932

## Codex Working Notes
### Current Handoff
- Hypothesis: Persisted artifact promotion was too permissive. Runtime external-review history accepted malformed optional evidence fields, and post-merge audit summarization trusted embedded local-review identity without checking it against the merged context.
- What changed: Added reusable identity/evidence validation helpers, enforced fail-closed validation before promoting persisted external-review miss artifacts, skipped post-merge audit artifacts whose embedded local-review issue/PR/branch/head identity mismatches the authoritative merged context, added focused regression tests, documented the guardrail in `docs/local-review.md`, merged `github/main` at `a5d6e16`, resolved the resulting conflicts in `src/supervisor/post-merge-audit-summary.ts` and `src/supervisor/post-merge-audit-summary.test.ts`, and tightened `src/external-review/external-review-miss-artifact.ts` so durable-guardrail provenance `issueNumber` and `prNumber` must be positive integers before promotion.
- Current blocker: none
- Next exact step: Monitor PR #1147 for refreshed review state on commit `6ad7898`, then resolve or respond to the remaining automated thread if no further changes are requested.
- Verification gap: Full repo `npm test` still includes unrelated browser-smoke coverage and was not used for this issue; the focused external-review artifact/history tests, post-merge audit summary test, and `npm run build` passed after this review fix.
- Files touched: docs/local-review.md; src/persisted-artifact-promotion.ts; src/external-review/external-review-miss-artifact.ts; src/external-review/external-review-miss-artifact.test.ts; src/external-review/external-review-miss-history.ts; src/external-review/external-review-miss-history.test.ts; src/local-review/repair-context.ts; src/local-review/runner.ts; src/supervisor/post-merge-audit-summary.ts; src/supervisor/post-merge-audit-summary.test.ts; src/supervisor/supervisor-status-rendering.ts
- Rollback concern: Tightened validation now skips malformed or mismatched persisted artifacts instead of promoting them; if older artifacts relied on permissive parsing, operator-facing summaries may surface fewer historical runtime hints until those artifacts are regenerated.
- Last focused commands: `npx tsx --test src/external-review/external-review-miss-artifact.test.ts src/external-review/external-review-miss-history.test.ts src/supervisor/post-merge-audit-summary.test.ts`; `npm run build`; `git commit -m "Tighten external review miss provenance validation"`; `git push github codex/issue-1144`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
