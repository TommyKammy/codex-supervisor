# Issue #698: Service boundary: add a thin supervisor application service for CLI and future API adapters

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/698
- Branch: codex/issue-698
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 4 (implementation=2, repair=2)
- Last head SHA: 940418be40cdaa0c3bf9f420505503f04319eedc
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ851qIHJ
- Repeated failure signature count: 1
- Updated at: 2026-03-20T08:23:35Z

## Latest Codex Summary
Validated the CodeRabbit portability review on PR [#703](https://github.com/TommyKammy/codex-supervisor/pull/703) and replaced checked-in workstation-specific path references in [.codex-supervisor/issue-journal.md](./.codex-supervisor/issue-journal.md) with repo-relative links plus neutral placeholders.

Summary: Removed tracked absolute home paths from the issue journal so the PR handoff no longer leaks workstation-specific path details.
State hint: local_review_fix
Blocked reason: none
Tests: `rg -n '/home/tommy' .codex-supervisor/issue-journal.md`; `git diff --check -- .codex-supervisor/issue-journal.md`
Failure signature: PRRT_kwDORgvdZ851qIHJ
Next action: Commit and push the journal-only review fix to `codex/issue-698`, then resolve the CodeRabbit thread on PR #703 if GitHub accepts the updated diff.

## Active Failure Context
- Category: review
- Summary: The CodeRabbit portability review on checked-in absolute paths is fixed locally and pending commit/push plus thread resolution.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/703#discussion_r2964518501
- Details:
  - `.codex-supervisor/issue-journal.md`: replaced tracked home-prefixed paths with repo-relative links/commands and neutral placeholders so the checked-in handoff no longer leaks workstation-specific path details.

## Codex Working Notes
### Current Handoff
- Hypothesis: the narrowest seam for issue #698 is to keep `Supervisor` as the core implementation, then add a thin `SupervisorService` wrapper that exposes transport-friendly query DTOs plus run-once operations so CLI and future adapters do not depend on `Supervisor` directly.
- What changed: added `src/supervisor/supervisor-service.ts` with `SupervisorService`, `SupervisorLock`, and `createSupervisorService(...)`; the wrapper delegates to existing `Supervisor` report/query methods and `runOnce(...)`. Updated `src/cli/entrypoint.ts` to create and pass the service boundary instead of `Supervisor.fromConfig(...)` directly. Updated `src/cli/supervisor-runtime.ts` to call `queryStatus`, `queryExplain`, `queryIssueLint`, `queryDoctor`, and `runOnce` on the service while keeping lock acquisition, signal handling, sleep, and loop orchestration in the CLI runtime. Added focused coverage in `src/cli/entrypoint.test.ts`, `src/cli/supervisor-runtime.test.ts`, and `src/supervisor/supervisor.test.ts` for the new boundary and export surface.
- Current blocker: none
- Next exact step: commit the journal-only portability fix, push `codex/issue-698`, and resolve the CodeRabbit review thread on PR #703.
- Verification gap: none against the issue acceptance criteria in this worktree; `npx tsx --test src/cli/supervisor-runtime.test.ts src/supervisor/supervisor.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts` and `npm run build` passed after `npm install` restored local `tsc`.
- Files touched: `src/cli/entrypoint.ts`, `src/cli/entrypoint.test.ts`, `src/cli/supervisor-runtime.ts`, `src/cli/supervisor-runtime.test.ts`, `src/supervisor/supervisor-service.ts`, `src/supervisor/index.ts`, `src/supervisor/supervisor.test.ts`, `.codex-supervisor/issue-journal.md`
- Rollback concern: reverting this checkpoint would put the CLI back on a transport-coupled path where adapters construct `Supervisor` directly instead of reusing an explicit application-service seam.
- Last focused command: `git diff -- .codex-supervisor/issue-journal.md`
- Last focused commands: `sed -n '1,220p' <memory-root>/issue-698/AGENTS.generated.md`; `sed -n '1,220p' <memory-root>/issue-698/context-index.md`; `sed -n '1,260p' .codex-supervisor/issue-journal.md`; `nl -ba .codex-supervisor/issue-journal.md | sed -n '1,120p'`; `git status --short`; `git branch --show-current`; `git rev-parse --short HEAD`; `git diff -- .codex-supervisor/issue-journal.md`
### Scratchpad
- 2026-03-20 (JST): Addressed CodeRabbit thread `PRRT_kwDORgvdZ851qIHJ` locally by replacing checked-in workstation-specific paths in `.codex-supervisor/issue-journal.md` with repo-relative links and path-neutral command text. Focused verification will be a journal diff/readback plus a search confirming no remaining home-prefixed workstation paths in the tracked journal.
- 2026-03-20 (JST): Pushed `codex/issue-698` to `origin` and opened draft PR #703 for the service-boundary slice. `gh pr status` shows the branch-associated PR with checks pending. No additional code changes were needed in this turn.
- 2026-03-19 (JST): Reproduced issue #559 with a focused `replay-corpus-promote` regression that expected advisory hints for `stale-head-prevents-merge` but only saw the existing explicit-case-id guidance and suggestions. Fixed it by adding deterministic `deriveReplayCorpusPromotionWorthinessHints(...)` coverage for stale-head safety, provider waits, and retry escalation, then surfacing those hints in both CLI suggestion mode and successful promotion summaries. Focused verification passed with `npx tsx --test src/index.test.ts --test-name-pattern "replay-corpus-promote"`, `npx tsx --test src/supervisor/replay-corpus.test.ts --test-name-pattern "PromotionWorthinessHints|promoteCapturedReplaySnapshot|checked-in safety case bundles|runReplayCorpus replays the checked-in PR lifecycle safety cases without mismatches"`, and `npm run build` after restoring local dev dependencies via `npm install`.
- 2026-03-19 (JST): Reproduced issue #558 with a tightened CLI promotion regression that failed because stdout only contained `Promoted replay corpus case ...`; fixed it by printing case path, compact expected outcome, and conditional volatile-field normalization notes after promotion. Focused verification passed with `npx tsx --test src/index.test.ts`, `npx tsx --test src/supervisor/replay-corpus.test.ts`, and `npm run build` after restoring local dev dependencies via `npm install`.
- 2026-03-19 (JST): Addressed CodeRabbit thread `PRRT_kwDORgvdZ851N_xt` by guarding replay corpus case-id suggestion derivation in `src/index.ts`; focused verification passed with `npx tsx --test src/index.test.ts` and `npm run build`.
- 2026-03-19 (JST): Added focused parser coverage for `replay-corpus-promote` plus an end-to-end CLI promotion regression in `src/index.test.ts`; the initial missing behavior was that the CLI had no dedicated promotion entry path at all.
- 2026-03-19 (JST): Implemented `replay-corpus-promote` in `src/index.ts` and extended `CliOptions` in `src/core/types.ts` with explicit `caseId` support; the new CLI path uses the existing `promoteCapturedReplaySnapshot(...)` implementation and defaults `corpusPath` to checked-in `replay-corpus`.
- 2026-03-19 (JST): Focused verification passed with `npx tsx --test src/index.test.ts src/supervisor/replay-corpus.test.ts`; `npm run build` first failed because `tsc` was missing locally, so ran `npm install` and reran `npm run build` successfully.
- 2026-03-19 (JST): Added `suggestReplayCorpusCaseIds(...)` with deterministic issue/state and normalized-title candidates, plus focused helper coverage in `src/supervisor/replay-corpus.test.ts`.
- 2026-03-19 (JST): Relaxed `parseArgs(...)` so `replay-corpus-promote <snapshotPath>` reaches `main()`, where the CLI now loads the snapshot and prints suggested case ids instead of failing before operators can see naming guidance.
