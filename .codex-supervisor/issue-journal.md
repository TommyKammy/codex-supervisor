# Issue #699: Event model: emit typed supervisor lifecycle and recovery events for transport adapters

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/699
- Branch: codex/issue-699
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: stabilizing
- Attempt count: 2 (implementation=2, repair=0)
- Last head SHA: 823d1952972c004045f014ba6a38f8336a2da5c8
- Blocked reason: none
- Last failure signature: typed-supervisor-events-missing
- Repeated failure signature count: 0
- Updated at: 2026-03-20T08:53:34Z

## Latest Codex Summary
- Added a typed supervisor event model and optional event sink for transport adapters without changing existing CLI output. Recovery events now emit from `runOnceCyclePrelude`, active-issue reservation and loop skips emit from `resolveRunnableIssueContext`, review-wait changes emit from both PR lifecycle sync points, and run-lock blockage emits from `Supervisor.acquireSupervisorLock`. Exported the event model through `src/supervisor/index.ts` and extended `createSupervisorService(...)` so adapters can attach an `onEvent` consumer.

## Active Failure Context
- Resolved during this turn: initial focused reproducer tests failed because no transport event sink existed, so emitted arrays stayed empty for recovery, active-issue, loop-skip, review-wait, and run-lock families.
- Environment note: `npm run build` initially failed with `sh: 1: tsc: not found`; running `npm install` restored the local TypeScript dependency and the subsequent build passed.

## Codex Working Notes
### Current Handoff
- Hypothesis: the lowest-risk implementation is an opt-in discriminated union plus callback sink threaded through existing supervisor decision points, leaving text rendering and replay artifacts untouched.
- What changed: added `src/supervisor/supervisor-events.ts` with the typed event union and helper builders. Updated `src/run-once-cycle-prelude.ts` to emit typed recovery events as reconciliation phases surface them. Updated `src/run-once-issue-selection.ts` to emit active-issue reservation and issue-lock loop-skip events. Updated `src/post-turn-pull-request.ts` plus `src/supervisor/supervisor.ts` to emit review-wait changes from both lifecycle sync paths. Updated `src/supervisor/supervisor.ts` and `src/supervisor/supervisor-service.ts` so callers can attach `onEvent` and receive typed run-lock blockage events. Exported the event model via `src/supervisor/index.ts`.
- Current blocker: none
- Next exact step: stage the event-model changes, commit them on `codex/issue-699`, and open or update the branch PR if required by the supervisor flow.
- Verification gap: none found against the issue acceptance criteria after focused event coverage and the requested supervisor/runtime regression suite passed.
- Files touched: `src/supervisor/supervisor-events.ts`, `src/run-once-cycle-prelude.ts`, `src/run-once-issue-selection.ts`, `src/post-turn-pull-request.ts`, `src/supervisor/supervisor.ts`, `src/supervisor/supervisor-service.ts`, `src/supervisor/index.ts`, `src/run-once-cycle-prelude.test.ts`, `src/run-once-issue-selection.test.ts`, `src/post-turn-pull-request.test.ts`, `src/supervisor/supervisor-diagnostics-status-selection.test.ts`, `.codex-supervisor/issue-journal.md`
- Rollback concern: reverting this checkpoint would remove the new transport-friendly lifecycle/recovery event stream and force future adapters back to scraping logs or rendered status text.
- Last focused command: `npm run build`
- Last focused commands: `sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-699/AGENTS.generated.md`; `sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-699/context-index.md`; `sed -n '1,260p' .codex-supervisor/issue-journal.md`; `rg -n "event|emit|recovery|run-lock|review-wait|active issue|loop skip|loop-skip|run lock|review wait" src/supervisor src/cli`; `sed -n '1,360p' src/run-once-issue-selection.test.ts`; `sed -n '1,220p' src/post-turn-pull-request.test.ts`; `sed -n '1,260p' src/run-once-cycle-prelude.test.ts`; `sed -n '284,390p' src/supervisor/supervisor-diagnostics-status-selection.test.ts`; `npx tsx --test src/run-once-cycle-prelude.test.ts src/run-once-issue-selection.test.ts src/post-turn-pull-request.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts`; `npm install`; `npx tsx --test src/run-once-cycle-prelude.test.ts src/run-once-issue-selection.test.ts src/post-turn-pull-request.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts src/supervisor/supervisor-cycle-snapshot.test.ts src/supervisor/supervisor-recovery-reconciliation.test.ts src/cli/supervisor-runtime.test.ts`; `npm run build`
### Scratchpad
- 2026-03-19 (JST): Reproduced issue #559 with a focused `replay-corpus-promote` regression that expected advisory hints for `stale-head-prevents-merge` but only saw the existing explicit-case-id guidance and suggestions. Fixed it by adding deterministic `deriveReplayCorpusPromotionWorthinessHints(...)` coverage for stale-head safety, provider waits, and retry escalation, then surfacing those hints in both CLI suggestion mode and successful promotion summaries. Focused verification passed with `npx tsx --test src/index.test.ts --test-name-pattern "replay-corpus-promote"`, `npx tsx --test src/supervisor/replay-corpus.test.ts --test-name-pattern "PromotionWorthinessHints|promoteCapturedReplaySnapshot|checked-in safety case bundles|runReplayCorpus replays the checked-in PR lifecycle safety cases without mismatches"`, and `npm run build` after restoring local dev dependencies via `npm install`.
- 2026-03-19 (JST): Reproduced issue #558 with a tightened CLI promotion regression that failed because stdout only contained `Promoted replay corpus case ...`; fixed it by printing case path, compact expected outcome, and conditional volatile-field normalization notes after promotion. Focused verification passed with `npx tsx --test src/index.test.ts`, `npx tsx --test src/supervisor/replay-corpus.test.ts`, and `npm run build` after restoring local dev dependencies via `npm install`.
- 2026-03-19 (JST): Addressed CodeRabbit thread `PRRT_kwDORgvdZ851N_xt` by guarding replay corpus case-id suggestion derivation in `src/index.ts`; focused verification passed with `npx tsx --test src/index.test.ts` and `npm run build`.
- 2026-03-19 (JST): Added focused parser coverage for `replay-corpus-promote` plus an end-to-end CLI promotion regression in `src/index.test.ts`; the initial missing behavior was that the CLI had no dedicated promotion entry path at all.
- 2026-03-19 (JST): Implemented `replay-corpus-promote` in `src/index.ts` and extended `CliOptions` in `src/core/types.ts` with explicit `caseId` support; the new CLI path uses the existing `promoteCapturedReplaySnapshot(...)` implementation and defaults `corpusPath` to checked-in `replay-corpus`.
- 2026-03-19 (JST): Focused verification passed with `npx tsx --test src/index.test.ts src/supervisor/replay-corpus.test.ts`; `npm run build` first failed because `tsc` was missing locally, so ran `npm install` and reran `npm run build` successfully.
- 2026-03-19 (JST): Added `suggestReplayCorpusCaseIds(...)` with deterministic issue/state and normalized-title candidates, plus focused helper coverage in `src/supervisor/replay-corpus.test.ts`.
- 2026-03-19 (JST): Relaxed `parseArgs(...)` so `replay-corpus-promote <snapshotPath>` reaches `main()`, where the CLI now loads the snapshot and prints suggested case ids instead of failing before operators can see naming guidance.
