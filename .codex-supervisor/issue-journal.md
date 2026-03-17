# Issue #510: External-review misses: assign one prevention target to every missed finding

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/510
- Branch: codex/issue-510
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: draft_pr
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 55659cd72678ce093c3a52aba08798ec806ced27
- Blocked reason: none
- Last failure signature: missing-prevention-target
- Repeated failure signature count: 0
- Updated at: 2026-03-17T23:25:08Z

## Latest Codex Summary
- Added deterministic external-review prevention-target assignment at artifact build time so every missed finding now carries exactly one normalized next harness action. Focused coverage proves mixed `review_thread`/`top_level_review`/`issue_comment` cases and persisted artifact output; `npm ci` restored `tsc`, then focused prompt/external-review tests and `npm run build` passed.

Summary: Added deterministic prevention targets to external-review miss artifacts and verified the focused miss-classification/build path.
State hint: draft_pr
Blocked reason: none
Tests: `npx tsx --test src/codex/codex-prompt.test.ts src/external-review/external-review-classifier.test.ts src/external-review/external-review-miss-artifact.test.ts src/external-review/external-review-miss-persistence.test.ts`; `npm ci`; `npm run build`
Failure signature: none
Next action: Commit this checkpoint on `codex/issue-510`, then open or update the draft PR for issue #510.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: issue #510 is locally complete; the artifact should be the only place that needs the normalized prevention target because match classification behavior did not need to change.
- What changed: added `external-review-prevention-targets.ts`, enriched persisted artifact findings with `preventionTarget`, updated focused artifact/persistence coverage, and fixed prompt fixtures to carry the new required field.
- Current blocker: none
- Next exact step: commit the working tree and open or update the draft PR with the focused verification results.
- Verification gap: none locally after rerunning focused prompt/external-review tests and `npm run build`.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/codex/codex-prompt.test.ts`, `src/external-review/external-review-prevention-targets.ts`, `src/external-review/external-review-miss-artifact-types.ts`, `src/external-review/external-review-miss-artifact.ts`, `src/external-review/external-review-miss-artifact.test.ts`, `src/external-review/external-review-miss-persistence.test.ts`
- Rollback concern: removing the artifact-level enrichment would reintroduce misses with no explicit next harness action and break the new artifact/prompt type expectations.
- Last focused command: `npx tsx --test src/codex/codex-prompt.test.ts src/external-review/external-review-classifier.test.ts src/external-review/external-review-miss-artifact.test.ts src/external-review/external-review-miss-persistence.test.ts && npm run build`

### Scratchpad (workspace-local date in Asia/Tokyo unless noted)
- 2026-03-18 (JST): Focused reproducer first failed in `src/external-review/external-review-miss-artifact.test.ts` because missed findings in the artifact had `preventionTarget: undefined`; failure signature: `missing-prevention-target`.
- 2026-03-18 (JST): Deterministic target precedence is `issue_comment -> issue_template`, `top_level_review -> review_prompt`, severe anchored `review_thread` misses -> `durable_guardrail`, regression-qualified `review_thread` misses -> `regression_test`, otherwise `review_prompt`.
- 2026-03-18 (JST): `npm run build` initially failed with `sh: 1: tsc: not found`; `npm ci` restored the local toolchain and the rerun passed.
