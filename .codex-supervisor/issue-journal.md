# Issue #696: Status API prep: expose typed supervisor status and explain DTOs before CLI rendering

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/696
- Branch: codex/issue-696
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: stabilizing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: e035331c633865aa0fbd34031620a545a8e9741e
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-20T07:07:24.000Z

## Latest Codex Summary
- Reproduced the missing transport seam with focused tests that failed on `supervisor.statusReport()` and `supervisor.explainReport()` not existing. Implemented additive DTO-first query methods for `status`, `explain`, and `doctor`, added render helpers so the CLI still prints the same lines, re-exported the explain DTO helpers, and verified the focused supervisor/doctor tests plus `npm run build` after restoring local dependencies with `npm install`.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the safest fix is to expose typed transport DTOs one layer above the existing line renderers, not to redesign the status/explain computation itself. `doctor` already proves that pattern, so `status` and `explain` should follow it and keep existing CLI strings as a pure render step.
- What changed: added focused DTO assertions in `src/supervisor/supervisor-diagnostics-status-selection.test.ts`, `src/supervisor/supervisor-diagnostics-explain.test.ts`, and the existing `doctor` diagnostic-path test. Introduced `SupervisorExplainDto` plus `buildIssueExplainDto(...)` and `renderIssueExplainDto(...)` in `src/supervisor/supervisor-selection-issue-explain.ts`, added `SupervisorStatusDto` plus `renderSupervisorStatusDto(...)` in `src/supervisor/supervisor-status-report.ts`, and routed `Supervisor.status()`, `Supervisor.explain()`, and `Supervisor.doctor()` through new structured `statusReport()`, `explainReport()`, and `doctorReport()` methods. Re-exported the new explain helpers from `src/supervisor/supervisor-selection-status.ts` and `src/supervisor/index.ts`.
- Current blocker: none
- Next exact step: commit this DTO-first checkpoint on `codex/issue-696`, then open or update a draft PR if one does not already exist.
- Verification gap: none against the current acceptance criteria; the focused supervisor/doctor test set passed and `npm run build` passed after `npm install` restored `tsc`.
- Files touched: `src/supervisor/supervisor.ts`, `src/supervisor/supervisor-selection-issue-explain.ts`, `src/supervisor/supervisor-status-report.ts`, `src/supervisor/supervisor-selection-status.ts`, `src/supervisor/index.ts`, `src/supervisor/supervisor-diagnostics-status-selection.test.ts`, `src/supervisor/supervisor-diagnostics-explain.test.ts`, `src/supervisor/supervisor-selection-status.test.ts`, `.codex-supervisor/issue-journal.md`
- Rollback concern: reverting this checkpoint would force future transports back to parsing rendered CLI strings for supervisor `status` and `explain`, undoing the structured seam that this issue is meant to establish.
- Last focused command: `npm run build`
- Last focused commands: `sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-696/AGENTS.generated.md`; `sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-696/context-index.md`; `sed -n '1,260p' .codex-supervisor/issue-journal.md`; `rg -n "buildIssueExplainSummary|supervisor\\.status\\(|diagnoseSupervisorHost|renderDoctorReport|status\\(" src/index.ts src/cli src/supervisor src/doctor.ts`; `npx tsx --test src/supervisor/supervisor-diagnostics-status-selection.test.ts src/supervisor/supervisor-diagnostics-explain.test.ts`; `npx tsx --test src/supervisor/supervisor-status-model.test.ts src/supervisor/supervisor-status-model-supervisor.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts src/supervisor/supervisor-diagnostics-explain.test.ts src/doctor.test.ts`; `npm install`; `npm run build`
### Scratchpad
- 2026-03-20 (JST): Reproduced #696 with focused tests that failed on missing `Supervisor.statusReport()` and `Supervisor.explainReport()` methods, then implemented DTO-first status/explain/doctor query methods and render helpers. Focused verification passed with `npx tsx --test src/supervisor/supervisor-status-model.test.ts src/supervisor/supervisor-status-model-supervisor.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts src/supervisor/supervisor-diagnostics-explain.test.ts src/doctor.test.ts`, and `npm run build` passed after restoring local dependencies with `npm install`.
- 2026-03-19 (JST): Pushed `codex/issue-559` and opened draft PR #582 (`https://github.com/TommyKammy/codex-supervisor/pull/582`) after the focused hinting slice passed local verification.
- 2026-03-19 (JST): Reproduced issue #559 with a focused `replay-corpus-promote` regression that expected advisory hints for `stale-head-prevents-merge` but only saw the existing explicit-case-id guidance and suggestions. Fixed it by adding deterministic `deriveReplayCorpusPromotionWorthinessHints(...)` coverage for stale-head safety, provider waits, and retry escalation, then surfacing those hints in both CLI suggestion mode and successful promotion summaries. Focused verification passed with `npx tsx --test src/index.test.ts --test-name-pattern "replay-corpus-promote"`, `npx tsx --test src/supervisor/replay-corpus.test.ts --test-name-pattern "PromotionWorthinessHints|promoteCapturedReplaySnapshot|checked-in safety case bundles|runReplayCorpus replays the checked-in PR lifecycle safety cases without mismatches"`, and `npm run build` after restoring local dev dependencies via `npm install`.
- 2026-03-19 (JST): Reproduced issue #558 with a tightened CLI promotion regression that failed because stdout only contained `Promoted replay corpus case ...`; fixed it by printing case path, compact expected outcome, and conditional volatile-field normalization notes after promotion. Focused verification passed with `npx tsx --test src/index.test.ts`, `npx tsx --test src/supervisor/replay-corpus.test.ts`, and `npm run build` after restoring local dev dependencies via `npm install`.
- 2026-03-19 (JST): Addressed CodeRabbit thread `PRRT_kwDORgvdZ851N_xt` by guarding replay corpus case-id suggestion derivation in `src/index.ts`; focused verification passed with `npx tsx --test src/index.test.ts` and `npm run build`.
- 2026-03-19 (JST): Added focused parser coverage for `replay-corpus-promote` plus an end-to-end CLI promotion regression in `src/index.test.ts`; the initial missing behavior was that the CLI had no dedicated promotion entry path at all.
- 2026-03-19 (JST): Implemented `replay-corpus-promote` in `src/index.ts` and extended `CliOptions` in `src/core/types.ts` with explicit `caseId` support; the new CLI path uses the existing `promoteCapturedReplaySnapshot(...)` implementation and defaults `corpusPath` to checked-in `replay-corpus`.
- 2026-03-19 (JST): Focused verification passed with `npx tsx --test src/index.test.ts src/supervisor/replay-corpus.test.ts`; `npm run build` first failed because `tsc` was missing locally, so ran `npm install` and reran `npm run build` successfully.
- 2026-03-19 (JST): Added `suggestReplayCorpusCaseIds(...)` with deterministic issue/state and normalized-title candidates, plus focused helper coverage in `src/supervisor/replay-corpus.test.ts`.
- 2026-03-19 (JST): Relaxed `parseArgs(...)` so `replay-corpus-promote <snapshotPath>` reaches `main()`, where the CLI now loads the snapshot and prints suggested case ids instead of failing before operators can see naming guidance.
