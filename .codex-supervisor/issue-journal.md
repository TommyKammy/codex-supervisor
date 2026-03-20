# Issue #698: Service boundary: add a thin supervisor application service for CLI and future API adapters

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/698
- Branch: codex/issue-698
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 7ec81c1d932f541d9cc68ac343f53ba2f88e0c56
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-20T07:55:01.375Z

## Latest Codex Summary
- Added a thin `SupervisorService` application boundary for CLI query and run-once operations, routed the CLI runtime through it, and kept loop/signal/sleep orchestration in `src/cli/supervisor-runtime.ts`. Focused verification and `npm run build` now pass after restoring local `tsc` with `npm install`.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the narrowest seam for issue #698 is to keep `Supervisor` as the core implementation, then add a thin `SupervisorService` wrapper that exposes transport-friendly query DTOs plus run-once operations so CLI and future adapters do not depend on `Supervisor` directly.
- What changed: added `src/supervisor/supervisor-service.ts` with `SupervisorService`, `SupervisorLock`, and `createSupervisorService(...)`; the wrapper delegates to existing `Supervisor` report/query methods and `runOnce(...)`. Updated `src/cli/entrypoint.ts` to create and pass the service boundary instead of `Supervisor.fromConfig(...)` directly. Updated `src/cli/supervisor-runtime.ts` to call `queryStatus`, `queryExplain`, `queryIssueLint`, `queryDoctor`, and `runOnce` on the service while keeping lock acquisition, signal handling, sleep, and loop orchestration in the CLI runtime. Added focused coverage in `src/cli/entrypoint.test.ts`, `src/cli/supervisor-runtime.test.ts`, and `src/supervisor/supervisor.test.ts` for the new boundary and export surface.
- Current blocker: none
- Next exact step: checkpoint the service-boundary slice, then open or update the draft PR so CI can validate the CLI/service seam against the full matrix.
- Verification gap: none against the issue acceptance criteria in this worktree; `npx tsx --test src/cli/supervisor-runtime.test.ts src/supervisor/supervisor.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts` and `npm run build` passed after `npm install` restored local `tsc`.
- Files touched: `src/cli/entrypoint.ts`, `src/cli/entrypoint.test.ts`, `src/cli/supervisor-runtime.ts`, `src/cli/supervisor-runtime.test.ts`, `src/supervisor/supervisor-service.ts`, `src/supervisor/index.ts`, `src/supervisor/supervisor.test.ts`, `.codex-supervisor/issue-journal.md`
- Rollback concern: reverting this checkpoint would put the CLI back on a transport-coupled path where adapters construct `Supervisor` directly instead of reusing an explicit application-service seam.
- Last focused command: `npm run build`
- Last focused commands: `sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-698/AGENTS.generated.md`; `sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-698/context-index.md`; `sed -n '1,260p' .codex-supervisor/issue-journal.md`; `rg -n "supervisor-runtime|runOnce|query|diagnostics|service" src`; `sed -n '1,260p' src/cli/supervisor-runtime.ts`; `sed -n '1,280p' src/cli/entrypoint.test.ts`; `sed -n '1,280p' src/cli/entrypoint.ts`; `npx tsx --test src/cli/entrypoint.test.ts src/cli/supervisor-runtime.test.ts src/supervisor/supervisor.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts`; `npm install`; `npx tsx --test src/cli/supervisor-runtime.test.ts src/supervisor/supervisor.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts`; `npm run build`
### Scratchpad
- 2026-03-20 (JST): Reproduced issue #698 with focused CLI/runtime seam tests that failed because `runCli(...)` still called `Supervisor.fromConfig(...)` directly and `runSupervisorCommand(...)` still depended on `dependencies.supervisor`. Fixed it by adding a thin `SupervisorService` wrapper over `Supervisor`, routing CLI entrypoint/runtime through that boundary, and keeping loop/signal/sleep orchestration in the CLI runtime. Focused verification passed with `npx tsx --test src/cli/entrypoint.test.ts src/cli/supervisor-runtime.test.ts src/supervisor/supervisor.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts`; required verification passed with `npx tsx --test src/cli/supervisor-runtime.test.ts src/supervisor/supervisor.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts` and `npm run build` after `npm install`.
- 2026-03-20 (JST): Reproduced issue #697 with new focused coverage for `loadConfigSummary(...)` and `diagnoseBootstrapReadiness(...)`; the initial failure was missing exported helpers plus a pre-existing README/provider-profile assertion drift in `src/config.test.ts`. Implemented structured config/bootstrap DTOs on top of the existing loaders/checks, restored the README provider profile section, and verified with `npx tsx --test src/config.test.ts src/doctor.test.ts` and `npm run build` after `npm install`.
- 2026-03-19 (JST): Reproduced issue #559 with a focused `replay-corpus-promote` regression that expected advisory hints for `stale-head-prevents-merge` but only saw the existing explicit-case-id guidance and suggestions. Fixed it by adding deterministic `deriveReplayCorpusPromotionWorthinessHints(...)` coverage for stale-head safety, provider waits, and retry escalation, then surfacing those hints in both CLI suggestion mode and successful promotion summaries. Focused verification passed with `npx tsx --test src/index.test.ts --test-name-pattern "replay-corpus-promote"`, `npx tsx --test src/supervisor/replay-corpus.test.ts --test-name-pattern "PromotionWorthinessHints|promoteCapturedReplaySnapshot|checked-in safety case bundles|runReplayCorpus replays the checked-in PR lifecycle safety cases without mismatches"`, and `npm run build` after restoring local dev dependencies via `npm install`.
- 2026-03-19 (JST): Reproduced issue #558 with a tightened CLI promotion regression that failed because stdout only contained `Promoted replay corpus case ...`; fixed it by printing case path, compact expected outcome, and conditional volatile-field normalization notes after promotion. Focused verification passed with `npx tsx --test src/index.test.ts`, `npx tsx --test src/supervisor/replay-corpus.test.ts`, and `npm run build` after restoring local dev dependencies via `npm install`.
- 2026-03-19 (JST): Addressed CodeRabbit thread `PRRT_kwDORgvdZ851N_xt` by guarding replay corpus case-id suggestion derivation in `src/index.ts`; focused verification passed with `npx tsx --test src/index.test.ts` and `npm run build`.
- 2026-03-19 (JST): Added focused parser coverage for `replay-corpus-promote` plus an end-to-end CLI promotion regression in `src/index.test.ts`; the initial missing behavior was that the CLI had no dedicated promotion entry path at all.
- 2026-03-19 (JST): Implemented `replay-corpus-promote` in `src/index.ts` and extended `CliOptions` in `src/core/types.ts` with explicit `caseId` support; the new CLI path uses the existing `promoteCapturedReplaySnapshot(...)` implementation and defaults `corpusPath` to checked-in `replay-corpus`.
- 2026-03-19 (JST): Focused verification passed with `npx tsx --test src/index.test.ts src/supervisor/replay-corpus.test.ts`; `npm run build` first failed because `tsc` was missing locally, so ran `npm install` and reran `npm run build` successfully.
- 2026-03-19 (JST): Added `suggestReplayCorpusCaseIds(...)` with deterministic issue/state and normalized-title candidates, plus focused helper coverage in `src/supervisor/replay-corpus.test.ts`.
- 2026-03-19 (JST): Relaxed `parseArgs(...)` so `replay-corpus-promote <snapshotPath>` reaches `main()`, where the CLI now loads the snapshot and prints suggested case ids instead of failing before operators can see naming guidance.
