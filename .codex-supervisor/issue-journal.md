# Issue #591: Recovery gap: stop infinite stale-state cleanup loops for obsolete tracked issues without a PR

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/591
- Branch: codex/issue-591
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: ad17127d4debbfebc804da503cc9d4e13b460a90
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-18T22:43:54.344Z

## Latest Codex Summary
- None yet.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: stale `stabilizing` reservations that have no surviving tracked PR can be requeued forever because stale cleanup never records a repeat-tracked signature for that exact no-PR recovery loop.
- What changed: added a focused recovery reconciliation regression that reproduces the repeated stale `stabilizing` no-PR loop at the repeat limit, then taught `reconcileStaleActiveIssueReservation(...)` to record a stable failure signature for the narrow stale-no-PR case and converge it into `blocked` with `blocked_reason=manual_review` plus an operator-facing stop reason once the configured repeat limit is reached.
- Current blocker: none
- Next exact step: commit the stale-loop convergence slice, open a draft PR for `codex/issue-591`, and watch CI/review feedback.
- Verification gap: none; `src/supervisor/supervisor-recovery-reconciliation.test.ts`, `src/supervisor/supervisor-execution-orchestration.test.ts --test-name-pattern "reclaims a stale stabilizing issue without carrying mismatched tracked PR context"`, and `npm run build` all passed after restoring local dependencies with `npm install`.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/recovery-reconciliation.ts`, `src/supervisor/supervisor-recovery-reconciliation.test.ts`, `src/supervisor/supervisor.ts`
- Rollback concern: reverting this change would restore the infinite stale cleanup loop for obsolete tracked issues that already lost their PR context, hiding the manual operator action behind repeated automatic retries again.
- Last focused command: `npx tsx --test src/supervisor/supervisor-recovery-reconciliation.test.ts`; `npx tsx --test src/supervisor/supervisor-execution-orchestration.test.ts --test-name-pattern "reclaims a stale stabilizing issue without carrying mismatched tracked PR context"`; `npm run build`
### Scratchpad
- 2026-03-19 (JST): Reproduced issue #591 with a focused reconciliation regression: a `stabilizing` record whose locks were stale, `pr_number` was null, and the same stale no-PR recovery signature was already at `sameFailureSignatureRepeatLimit - 1` still requeued to `queued` instead of stopping. Fixed it by adding repeat-tracked stale-no-PR failure context in `reconcileStaleActiveIssueReservation(...)` and converting that narrow loop into `blocked(manual_review)` with a `stale_state_manual_stop` recovery reason at the repeat limit. Verification passed with `npx tsx --test src/supervisor/supervisor-recovery-reconciliation.test.ts`, `npx tsx --test src/supervisor/supervisor-execution-orchestration.test.ts --test-name-pattern "reclaims a stale stabilizing issue without carrying mismatched tracked PR context"`, and `npm run build` after restoring local deps via `npm install`.
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
