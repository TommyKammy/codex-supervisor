# Issue #697: Bootstrap API prep: expose structured config and host-readiness summary

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/697
- Branch: codex/issue-697
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 3f8531c1130e2f3804eddbb703dfc00df9e3c5fa
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-20T07:28:10.945Z

## Latest Codex Summary
- Added structured bootstrap/config DTOs so transports can inspect resolved config state, missing required fields, repo suitability, and doctor checks without parsing CLI text. Focused tests and `npm run build` pass in this worktree after restoring local dev dependencies with `npm install`.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the narrowest seam for issue #697 is to keep `loadConfig(...)` and `diagnoseSupervisorHost(...)` as the source of truth, then wrap them in transport-friendly summaries instead of teaching future adapters to parse thrown errors or rendered doctor lines.
- What changed: added `ConfigLoadSummary` plus `loadConfigSummary(...)` in `src/core/config.ts` so callers can inspect resolved config, missing required fields, and invalid-field failures without exceptions. Added `BootstrapReadinessSummary` plus `diagnoseBootstrapReadiness(...)` in `src/doctor.ts` so callers can inspect config readiness, repo suitability, and doctor checks in one JSON-friendly object while leaving `renderDoctorReport(...)` untouched. Added focused coverage in `src/config.test.ts` and `src/doctor.test.ts` for missing required config and fully ready bootstrap cases. Restored the README provider-profiles section so the required `src/config.test.ts` target passes again.
- Current blocker: none
- Next exact step: commit this structured config/bootstrap checkpoint, then open or update the draft PR so CI can validate the new DTO seam and the restored README/test alignment.
- Verification gap: none against the current acceptance criteria in this worktree; `npx tsx --test src/config.test.ts src/doctor.test.ts` and `npm run build` passed after `npm install` restored `tsc`.
- Files touched: `src/core/config.ts`, `src/config.test.ts`, `src/doctor.ts`, `src/doctor.test.ts`, `README.md`, `.codex-supervisor/issue-journal.md`
- Rollback concern: reverting this checkpoint would remove the structured config/bootstrap summary and push future WebUI/API adapters back toward exception parsing and doctor text scraping.
- Last focused command: `npm run build`
- Last focused commands: `sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-697/AGENTS.generated.md`; `sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-697/context-index.md`; `sed -n '1,260p' .codex-supervisor/issue-journal.md`; `git status --short`; `git branch --show-current`; `rg -n "config|bootstrap|readiness|doctorReport|renderDoctorReport|loadConfig|structured" src`; `sed -n '1,360p' src/core/config.ts`; `sed -n '1,320p' src/doctor.ts`; `sed -n '1,320p' src/config.test.ts`; `sed -n '1,320p' src/doctor.test.ts`; `npx tsx --test src/config.test.ts src/doctor.test.ts`; `npm install`; `npm run build`
### Scratchpad
- 2026-03-20 (JST): Reproduced issue #697 with new focused coverage for `loadConfigSummary(...)` and `diagnoseBootstrapReadiness(...)`; the initial failure was missing exported helpers plus a pre-existing README/provider-profile assertion drift in `src/config.test.ts`. Implemented structured config/bootstrap DTOs on top of the existing loaders/checks, restored the README provider profile section, and verified with `npx tsx --test src/config.test.ts src/doctor.test.ts` and `npm run build` after `npm install`.
- 2026-03-19 (JST): Reproduced issue #559 with a focused `replay-corpus-promote` regression that expected advisory hints for `stale-head-prevents-merge` but only saw the existing explicit-case-id guidance and suggestions. Fixed it by adding deterministic `deriveReplayCorpusPromotionWorthinessHints(...)` coverage for stale-head safety, provider waits, and retry escalation, then surfacing those hints in both CLI suggestion mode and successful promotion summaries. Focused verification passed with `npx tsx --test src/index.test.ts --test-name-pattern "replay-corpus-promote"`, `npx tsx --test src/supervisor/replay-corpus.test.ts --test-name-pattern "PromotionWorthinessHints|promoteCapturedReplaySnapshot|checked-in safety case bundles|runReplayCorpus replays the checked-in PR lifecycle safety cases without mismatches"`, and `npm run build` after restoring local dev dependencies via `npm install`.
- 2026-03-19 (JST): Reproduced issue #558 with a tightened CLI promotion regression that failed because stdout only contained `Promoted replay corpus case ...`; fixed it by printing case path, compact expected outcome, and conditional volatile-field normalization notes after promotion. Focused verification passed with `npx tsx --test src/index.test.ts`, `npx tsx --test src/supervisor/replay-corpus.test.ts`, and `npm run build` after restoring local dev dependencies via `npm install`.
- 2026-03-19 (JST): Addressed CodeRabbit thread `PRRT_kwDORgvdZ851N_xt` by guarding replay corpus case-id suggestion derivation in `src/index.ts`; focused verification passed with `npx tsx --test src/index.test.ts` and `npm run build`.
- 2026-03-19 (JST): Added focused parser coverage for `replay-corpus-promote` plus an end-to-end CLI promotion regression in `src/index.test.ts`; the initial missing behavior was that the CLI had no dedicated promotion entry path at all.
- 2026-03-19 (JST): Implemented `replay-corpus-promote` in `src/index.ts` and extended `CliOptions` in `src/core/types.ts` with explicit `caseId` support; the new CLI path uses the existing `promoteCapturedReplaySnapshot(...)` implementation and defaults `corpusPath` to checked-in `replay-corpus`.
- 2026-03-19 (JST): Focused verification passed with `npx tsx --test src/index.test.ts src/supervisor/replay-corpus.test.ts`; `npm run build` first failed because `tsc` was missing locally, so ran `npm install` and reran `npm run build` successfully.
- 2026-03-19 (JST): Added `suggestReplayCorpusCaseIds(...)` with deterministic issue/state and normalized-title candidates, plus focused helper coverage in `src/supervisor/replay-corpus.test.ts`.
- 2026-03-19 (JST): Relaxed `parseArgs(...)` so `replay-corpus-promote <snapshotPath>` reaches `main()`, where the CLI now loads the snapshot and prints suggested case ids instead of failing before operators can see naming guidance.
