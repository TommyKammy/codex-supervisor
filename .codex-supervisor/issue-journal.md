# Issue #700: Safe mutations: add narrow explicit supervisor commands for operator recovery actions

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/700
- Branch: codex/issue-700
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: a72854764bbf15bbef3c1bf4bae6de951ab383c6
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-20T09:34:53Z

## Latest Codex Summary
- Added a narrow explicit `requeue` supervisor command with structured mutation results, conservative state checks, and focused CLI/runtime/recovery coverage.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the narrowest safe mutation surface for issue #700 is a dedicated `requeue` runtime command backed by a conservative helper that only requeues inactive blocked/failed issues with no tracked PR and rejects everything else explicitly.
- What changed: extended `CliOptions`, `parseArgs(...)`, and the supervisor runtime to accept `requeue <issueNumber>`, added `SupervisorMutationResultDto` plus JSON rendering for transport-friendly command output, and implemented `runRecoveryAction("requeue", ...)` through `requeueIssueForOperator(...)`. The helper records a recovery reason, clears stale failure/blocking fields, and rejects unsafe cases like active reservations or tracked-PR work. Added focused parser, entrypoint, runtime, and recovery tests for one successful safe mutation and one rejected unsafe mutation.
- Current blocker: none
- Next exact step: stage the issue #700 recovery-command changes, commit them on `codex/issue-700`, and push/update the branch or draft PR if needed.
- Verification gap: none in the requested local scope after the focused runtime/recovery tests and `npm run build` passed.
- Files touched: `src/cli/entrypoint.test.ts`, `src/cli/parse-args.test.ts`, `src/cli/parse-args.ts`, `src/cli/supervisor-runtime.test.ts`, `src/cli/supervisor-runtime.ts`, `src/core/types.ts`, `src/recovery-reconciliation.ts`, `src/supervisor/index.ts`, `src/supervisor/supervisor-mutation-report.ts`, `src/supervisor/supervisor-recovery-reconciliation.test.ts`, `src/supervisor/supervisor-service.ts`, `src/supervisor/supervisor.ts`, `.codex-supervisor/issue-journal.md`
- Rollback concern: reverting this checkpoint would remove the explicit operator recovery command surface and force future adapters back toward ambiguous state edits.
- Last focused command: `npm run build`
- Last focused commands: `sed -n '1,220p' $CODEX_MEMORY_ROOT/TommyKammy-codex-supervisor/issue-700/AGENTS.generated.md`; `sed -n '1,220p' $CODEX_MEMORY_ROOT/TommyKammy-codex-supervisor/issue-700/context-index.md`; `sed -n '1,260p' .codex-supervisor/issue-journal.md`; `git status --short --branch`; `rg -n "requeue|recovery|reservation|resume|mutation|command result|operator" src -g'*.ts'`; `sed -n '1,260p' src/cli/entrypoint.test.ts`; `sed -n '1,260p' src/cli/supervisor-runtime.test.ts`; `sed -n '1,260p' src/cli/parse-args.ts`; `sed -n '1,260p' src/cli/supervisor-runtime.ts`; `sed -n '1,260p' src/supervisor/supervisor-service.ts`; `sed -n '300,380p' src/core/types.ts`; `sed -n '1,260p' src/supervisor/supervisor-recovery-reconciliation.test.ts`; `sed -n '1,260p' src/core/state-store.ts`; `sed -n '1,260p' src/recovery-reconciliation.ts`; `npx tsx --test src/cli/parse-args.test.ts src/cli/entrypoint.test.ts src/cli/supervisor-runtime.test.ts src/supervisor/supervisor-recovery-reconciliation.test.ts`; `npx tsx --test src/cli/entrypoint.test.ts src/cli/supervisor-runtime.test.ts src/supervisor/supervisor-recovery-reconciliation.test.ts`; `npm install`; `npm run build`
### Scratchpad
- 2026-03-20 (JST): Reproduced issue #700 by adding focused tests for a missing `requeue` supervisor runtime command; implemented a structured `SupervisorMutationResultDto`, runtime JSON rendering, and a conservative `requeueIssueForOperator(...)` helper that only requeues inactive blocked/failed issues with no tracked PR and explicitly rejects active tracked-PR work. Verification passed with `npx tsx --test src/cli/parse-args.test.ts src/cli/entrypoint.test.ts src/cli/supervisor-runtime.test.ts src/supervisor/supervisor-recovery-reconciliation.test.ts`, `npx tsx --test src/cli/entrypoint.test.ts src/cli/supervisor-runtime.test.ts src/supervisor/supervisor-recovery-reconciliation.test.ts`, and `npm run build` after restoring local dev dependencies via `npm install`.
- 2026-03-19 (JST): Reproduced issue #558 with a tightened CLI promotion regression that failed because stdout only contained `Promoted replay corpus case ...`; fixed it by printing case path, compact expected outcome, and conditional volatile-field normalization notes after promotion. Focused verification passed with `npx tsx --test src/index.test.ts`, `npx tsx --test src/supervisor/replay-corpus.test.ts`, and `npm run build` after restoring local dev dependencies via `npm install`.
- 2026-03-19 (JST): Addressed CodeRabbit thread `PRRT_kwDORgvdZ851N_xt` by guarding replay corpus case-id suggestion derivation in `src/index.ts`; focused verification passed with `npx tsx --test src/index.test.ts` and `npm run build`.
- 2026-03-19 (JST): Added focused parser coverage for `replay-corpus-promote` plus an end-to-end CLI promotion regression in `src/index.test.ts`; the initial missing behavior was that the CLI had no dedicated promotion entry path at all.
- 2026-03-19 (JST): Implemented `replay-corpus-promote` in `src/index.ts` and extended `CliOptions` in `src/core/types.ts` with explicit `caseId` support; the new CLI path uses the existing `promoteCapturedReplaySnapshot(...)` implementation and defaults `corpusPath` to checked-in `replay-corpus`.
- 2026-03-19 (JST): Focused verification passed with `npx tsx --test src/index.test.ts src/supervisor/replay-corpus.test.ts`; `npm run build` first failed because `tsc` was missing locally, so ran `npm install` and reran `npm run build` successfully.
- 2026-03-19 (JST): Added `suggestReplayCorpusCaseIds(...)` with deterministic issue/state and normalized-title candidates, plus focused helper coverage in `src/supervisor/replay-corpus.test.ts`.
- 2026-03-19 (JST): Relaxed `parseArgs(...)` so `replay-corpus-promote <snapshotPath>` reaches `main()`, where the CLI now loads the snapshot and prints suggested case ids instead of failing before operators can see naming guidance.
