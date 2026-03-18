# Issue #591: Recovery gap: stop infinite stale-state cleanup loops for obsolete tracked issues without a PR

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/591
- Branch: codex/issue-591
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 2 (implementation=1, repair=1)
- Last head SHA: 070fbdd4d65e9b3612237d48c994697e9ebf79a0
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ851TzoO
- Repeated failure signature count: 1
- Updated at: 2026-03-18T22:55:36.317Z

## Latest Codex Summary
Implemented the narrow stale-recovery fix in [src/recovery-reconciliation.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-591/src/recovery-reconciliation.ts) and wired the repeat limit from [src/supervisor/supervisor.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-591/src/supervisor/supervisor.ts). A stale `stabilizing` record with no resolvable tracked PR now records a stable failure signature on requeue, and once that signature reaches the configured repeat limit it converges to `blocked` with `blocked_reason=manual_review`, a concrete operator-facing `last_error`, and a `stale_state_manual_stop` recovery reason instead of looping forever.

Focused coverage was added in [src/supervisor/supervisor-recovery-reconciliation.test.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-591/src/supervisor/supervisor-recovery-reconciliation.test.ts). Commit `070fbdd` is pushed on `codex/issue-591`, and draft PR #593 is open: https://github.com/TommyKammy/codex-supervisor/pull/593. `npm run build` initially failed because `tsc` was missing locally; running `npm install` restored local deps and the build passed. I left the unrelated untracked `.codex-supervisor/replay/` directory alone.

Summary: Added repeat-tracked stale no-PR recovery convergence so obsolete `stabilizing` issues stop in `blocked(manual_review)` instead of requeueing forever; pushed commit `070fbdd` and opened draft PR #593.
State hint: draft_pr
Blocked reason: none
Tests: `npx tsx --test src/supervisor/supervisor-recovery-reconciliation.test.ts`; `npx tsx --test src/supervisor/supervisor-execution-orchestration.test.ts --test-name-pattern "reclaims a stale stabilizing issue without carrying mismatched tracked PR context"`; `npm install`; `npm run build`
Failure signature: none
Next action: Watch PR #593 CI and address any review or failing-check feedback.

## Active Failure Context
- None recorded. Review thread `PRRT_kwDORgvdZ851TzoO` was resolved after pushing commit `0bf7781`.

## Codex Working Notes
### Current Handoff
- Hypothesis: the stale no-PR recovery loop fix is now complete for both directions, including clearing the repeat-tracked signature after PR context returns, so remaining risk is limited to new CI or review feedback.
- What changed: taught `reconcileStaleActiveIssueReservation(...)` to clear the stale no-PR `last_error`, `last_failure_context`, `last_failure_signature`, and `repeated_failure_signature_count` once `resolvePullRequestForBranch(...)` recovers tracked PR context for a `stabilizing` record, added focused regression coverage for that recovery path, pushed commit `0bf7781`, and resolved CodeRabbit thread `PRRT_kwDORgvdZ851TzoO` on PR #593.
- Current blocker: none
- Next exact step: watch PR #593 CI and any follow-up review feedback for commit `0bf7781`.
- Verification gap: none; `npx tsx --test src/supervisor/supervisor-recovery-reconciliation.test.ts` and `npm run build` passed after the review-fix patch.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/recovery-reconciliation.ts`, `src/supervisor/supervisor-recovery-reconciliation.test.ts`
- Rollback concern: reverting this follow-up would let resolved stale no-PR recovery state leak into later regressions, causing unrelated future no-PR recurrences to inherit an old repeat streak and potentially hit the manual-stop limit prematurely.
- Last focused command: `npx tsx --test src/supervisor/supervisor-recovery-reconciliation.test.ts`; `npm run build`; `git push origin codex/issue-591`; `gh api graphql -f query='mutation($threadId: ID!) { resolveReviewThread(input: { threadId: $threadId }) { thread { isResolved } } }' -F threadId='PRRT_kwDORgvdZ851TzoO'`
### Scratchpad
- 2026-03-19 (JST): Pushed review-fix commit `0bf7781` to `codex/issue-591` and resolved CodeRabbit thread `PRRT_kwDORgvdZ851TzoO` via `gh api graphql` after the focused reconciliation test and `npm run build` both passed.
- 2026-03-19 (JST): Addressed CodeRabbit thread `PRRT_kwDORgvdZ851TzoO` by reproducing the recovered-PR path in `reconcileStaleActiveIssueReservation(...)`; the non-requeue branch was still preserving the stale no-PR failure signature/count after PR context returned. Fixed it by clearing the stale no-PR failure fields on recovered PR context and added a focused regression in `src/supervisor/supervisor-recovery-reconciliation.test.ts`. Verification passed with `npx tsx --test src/supervisor/supervisor-recovery-reconciliation.test.ts` and `npm run build`.
- 2026-03-19 (JST): Reproduced issue #573 with a focused `issue-lint` regression: an authored issue containing `Part of: #104`, duplicate/self `Depends on`, `Execution order: 3 of 2`, and `Parallelizable: Later` still reported `execution_ready=yes` and no metadata problems. Fixed it by adding local metadata validation and a `metadata_errors=` summary line, then verified with `npx tsx --test src/issue-metadata/issue-metadata.test.ts src/supervisor/supervisor-diagnostics-issue-lint.test.ts` and `npm run build` after restoring local deps via `npm install`.
- 2026-03-19 (JST): Reproduced issue #561 with a focused docs regression in `src/agent-instructions-docs.test.ts`; it failed with `ENOENT` because `docs/agent-instructions.md` did not exist. Added the new bootstrap hub doc with prerequisites, read order, first-run sequence, escalation rules, and canonical links. Focused verification passed with `npx tsx --test src/agent-instructions-docs.test.ts src/getting-started-docs.test.ts` and `npm run build` after restoring local dev dependencies via `npm install`.
- 2026-03-19 (JST): Pushed `codex/issue-559` and opened draft PR #582 (`https://github.com/TommyKammy/codex-supervisor/pull/582`) after the focused hinting slice passed local verification.
- 2026-03-19 (JST): Reproduced issue #559 with a focused `replay-corpus-promote` regression that expected advisory hints for `stale-head-prevents-merge` but only saw the existing explicit-case-id guidance and suggestions. Fixed it by adding deterministic `deriveReplayCorpusPromotionWorthinessHints(...)` coverage for stale-head safety, provider waits, and retry escalation, then surfacing those hints in both CLI suggestion mode and successful promotion summaries. Focused verification passed with `npx tsx --test src/index.test.ts --test-name-pattern "replay-corpus-promote"`, `npx tsx --test src/supervisor/replay-corpus.test.ts --test-name-pattern "PromotionWorthinessHints|promoteCapturedReplaySnapshot|checked-in safety case bundles|runReplayCorpus replays the checked-in PR lifecycle safety cases without mismatches"`, and `npm run build` after restoring local dev dependencies via `npm install`.
- 2026-03-19 (JST): Reproduced issue #558 with a tightened CLI promotion regression that failed because stdout only contained `Promoted replay corpus case ...`; fixed it by printing case path, compact expected outcome, and conditional volatile-field normalization notes after promotion. Focused verification passed with `npx tsx --test src/index.test.ts`, `npx tsx --test src/supervisor/replay-corpus.test.ts`, and `npm run build` after restoring local dev dependencies via `npm install`.
- 2026-03-19 (JST): Addressed CodeRabbit thread `PRRT_kwDORgvdZ851N_xt` by guarding replay corpus case-id suggestion derivation in `src/index.ts`; focused verification passed with `npx tsx --test src/index.test.ts` and `npm run build`.
- 2026-03-19 (JST): Added focused parser coverage for `replay-corpus-promote` plus an end-to-end CLI promotion regression in `src/index.test.ts`; the initial missing behavior was that the CLI had no dedicated promotion entry path at all.
- 2026-03-19 (JST): Implemented `replay-corpus-promote` in `src/index.ts` and extended `CliOptions` in `src/core/types.ts` with explicit `caseId` support; the new CLI path uses the existing `promoteCapturedReplaySnapshot(...)` implementation and defaults `corpusPath` to checked-in `replay-corpus`.
- 2026-03-19 (JST): Focused verification passed with `npx tsx --test src/index.test.ts src/supervisor/replay-corpus.test.ts`; `npm run build` first failed because `tsc` was missing locally, so ran `npm install` and reran `npm run build` successfully.
- 2026-03-19 (JST): Added `suggestReplayCorpusCaseIds(...)` with deterministic issue/state and normalized-title candidates, plus focused helper coverage in `src/supervisor/replay-corpus.test.ts`.
- 2026-03-19 (JST): Relaxed `parseArgs(...)` so `replay-corpus-promote <snapshotPath>` reaches `main()`, where the CLI now loads the snapshot and prints suggested case ids instead of failing before operators can see naming guidance.
