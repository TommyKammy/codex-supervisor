# Issue #699: Event model: emit typed supervisor lifecycle and recovery events for transport adapters

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/699
- Branch: codex/issue-699
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 2 (implementation=1, repair=1)
- Last head SHA: 4bf709b3e4fb6e98aeea7aa57351fb62b2b92834
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ851qhfW|PRRT_kwDORgvdZ851qhfY
- Repeated failure signature count: 1
- Updated at: 2026-03-20T09:04:49.773Z

## Latest Codex Summary
Added a typed transport event model in `src/supervisor/supervisor-events.ts` and threaded an optional `onEvent` sink through the existing supervisor/service seams. Recovery events now emit from prelude reconciliation, active-issue and loop-skip events from issue selection, review-wait changes from PR lifecycle sync, and run-lock blockage from `src/supervisor/supervisor.ts`. CLI output stays unchanged when no consumer is attached.

Focused coverage was added for each representative event family, the requested supervisor/runtime regression tests passed, and `npm run build` passed after restoring local deps with `npm install`. Draft PR opened: `#704`.

Summary: Implemented typed supervisor lifecycle/recovery transport events, added focused family coverage, pushed branch, and opened draft PR #704.
State hint: draft_pr
Blocked reason: none
Tests: `npx tsx --test src/run-once-cycle-prelude.test.ts src/run-once-issue-selection.test.ts src/post-turn-pull-request.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts src/supervisor/supervisor-cycle-snapshot.test.ts src/supervisor/supervisor-recovery-reconciliation.test.ts src/cli/supervisor-runtime.test.ts`; `npm run build`
Failure signature: none
Next action: watch draft PR #704 CI/review feedback and address any follow-up failures or comments.

## Active Failure Context
- Category: review
- Summary: 2 unresolved automated review thread(s) remain.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/704#discussion_r2964653188
- Details:
  - `.codex-supervisor/issue-journal.md`: sanitize machine-specific absolute paths from the tracked summary and command notes so the journal stays portable.
  - `src/post-turn-pull-request.ts`: harden event emission so transport adapter sink failures are logged and swallowed after state persistence instead of aborting the transition.

## Codex Working Notes
### Current Handoff
- Hypothesis: the lowest-risk review fix is to harden the shared supervisor event sink boundary so all transport adapters fail open, then cover the post-ready review-wait path with a regression that proves state persistence still completes.
- What changed: updated `src/supervisor/supervisor-events.ts` so `emitSupervisorEvent(...)` returns early when no sink is attached, catches sink exceptions, and logs a contextual warning keyed by event type plus issue/PR or lock context instead of rethrowing. Added `src/post-turn-pull-request.test.ts` coverage that forces the review-wait event sink to throw after `stateStore.save(...)` and verifies the transition still succeeds. Sanitized this journal to remove machine-specific absolute paths from the tracked summary and command history.
- Current blocker: none
- Next exact step: stage the local review-fix changes, commit them on `codex/issue-699`, push the branch, and update PR #704 for the remaining review thread state.
- Verification gap: none found against the issue acceptance criteria after focused event coverage and the requested supervisor/runtime regression suite passed.
- Files touched: `src/supervisor/supervisor-events.ts`, `src/post-turn-pull-request.test.ts`, `.codex-supervisor/issue-journal.md`
- Rollback concern: reverting this checkpoint would make adapter sink failures abort supervisor transitions after state persistence and would reintroduce machine-specific path leakage in the tracked journal.
- Last focused command: `npm run build`
- Last focused commands: `sed -n '1,220p' $CODEX_MEMORY_ROOT/TommyKammy-codex-supervisor/issue-699/AGENTS.generated.md`; `sed -n '1,220p' $CODEX_MEMORY_ROOT/TommyKammy-codex-supervisor/issue-699/context-index.md`; `sed -n '1,260p' .codex-supervisor/issue-journal.md`; `rg -n "emitSupervisorEvent|maybeBuildReviewWaitChangedEvent|emitEvent|logger|console" src/post-turn-pull-request.ts src/supervisor -g'*.ts'`; `sed -n '300,380p' src/post-turn-pull-request.ts`; `sed -n '1,240p' src/supervisor/supervisor-events.ts`; `rg -n "<absolute-unix-home>|<absolute-macos-home>|<windows-drive-prefix>" .codex-supervisor/issue-journal.md`; `sed -n '1,260p' src/post-turn-pull-request.test.ts`; `npx tsx --test src/run-once-cycle-prelude.test.ts src/run-once-issue-selection.test.ts src/post-turn-pull-request.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts`; `npm run build`
### Scratchpad
- 2026-03-19 (JST): Reproduced issue #558 with a tightened CLI promotion regression that failed because stdout only contained `Promoted replay corpus case ...`; fixed it by printing case path, compact expected outcome, and conditional volatile-field normalization notes after promotion. Focused verification passed with `npx tsx --test src/index.test.ts`, `npx tsx --test src/supervisor/replay-corpus.test.ts`, and `npm run build` after restoring local dev dependencies via `npm install`.
- 2026-03-19 (JST): Addressed CodeRabbit thread `PRRT_kwDORgvdZ851N_xt` by guarding replay corpus case-id suggestion derivation in `src/index.ts`; focused verification passed with `npx tsx --test src/index.test.ts` and `npm run build`.
- 2026-03-19 (JST): Added focused parser coverage for `replay-corpus-promote` plus an end-to-end CLI promotion regression in `src/index.test.ts`; the initial missing behavior was that the CLI had no dedicated promotion entry path at all.
- 2026-03-19 (JST): Implemented `replay-corpus-promote` in `src/index.ts` and extended `CliOptions` in `src/core/types.ts` with explicit `caseId` support; the new CLI path uses the existing `promoteCapturedReplaySnapshot(...)` implementation and defaults `corpusPath` to checked-in `replay-corpus`.
- 2026-03-19 (JST): Focused verification passed with `npx tsx --test src/index.test.ts src/supervisor/replay-corpus.test.ts`; `npm run build` first failed because `tsc` was missing locally, so ran `npm install` and reran `npm run build` successfully.
- 2026-03-19 (JST): Added `suggestReplayCorpusCaseIds(...)` with deterministic issue/state and normalized-title candidates, plus focused helper coverage in `src/supervisor/replay-corpus.test.ts`.
- 2026-03-19 (JST): Relaxed `parseArgs(...)` so `replay-corpus-promote <snapshotPath>` reaches `main()`, where the CLI now loads the snapshot and prints suggested case ids instead of failing before operators can see naming guidance.
