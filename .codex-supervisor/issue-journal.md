# Issue #618: Index refactor: slim src/index.ts into a thin facade

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/618
- Branch: codex/issue-618
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: draft_pr
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 54baf4ed6bc490e6b0f94781b1df6b0f60adc345
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-19T05:41:12Z

## Latest Codex Summary
Opened draft PR #622 (`https://github.com/TommyKammy/codex-supervisor/pull/622`) for the CLI facade extraction after pushing commit `54baf4e` on `codex/issue-618`. [`src/cli/entrypoint.ts`](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-618/src/cli/entrypoint.ts) now owns CLI dispatch and top-level error handling, while [`src/index.ts`](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-618/src/index.ts) is a six-line direct-execution facade that only re-exports `parseArgs` and invokes `runCliMain(...)`.

Reproduced the new boundary with a narrow failing test (`Cannot find module './entrypoint'` in `src/cli/entrypoint.test.ts`), then fixed the only follow-on regression where direct execution silently stopped because `isDirectExecution()` compared against the extracted module path instead of `src/index.ts`. Focused verification passed with `npx tsx --test src/cli/entrypoint.test.ts src/index.test.ts src/cli/*.test.ts` and `npm run build` after restoring local dev dependencies with `npm install`.

Summary: Extracted a dedicated CLI entrypoint module, reduced `src/index.ts` to a thin facade, added focused entrypoint boundary tests, and opened draft PR #622.
State hint: draft_pr
Blocked reason: none
Tests: `npx tsx --test src/cli/entrypoint.test.ts src/index.test.ts src/cli/*.test.ts`; `npm run build`
Failure signature: none
Next action: monitor draft PR #622 for CI or review feedback and address any follow-up without broadening the facade scope

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the remaining `src/index.ts` weight is command routing and top-level error handling, so extracting a dedicated CLI entrypoint module should make `index.ts` a real facade without changing the public CLI behavior.
- What changed: added `src/cli/entrypoint.ts` for argument parsing, command dispatch, supervisor runtime handoff, top-level error handling, and direct-execution helpers; reduced `src/index.ts` to the re-export plus `runCliMain(...)` invocation; added focused `src/cli/entrypoint.test.ts` coverage for replay routing, replay-corpus IO, supervisor-runtime dispatch, and stderr/exit failure handling.
- Current blocker: none
- Next exact step: monitor draft PR #622 for CI or review feedback and handle follow-up without broadening the refactor beyond the CLI facade boundary.
- Verification gap: none after `src/cli/entrypoint.test.ts`, the existing CLI/index focused tests, and `npm run build` all passed locally.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/cli/entrypoint.ts`, `src/cli/entrypoint.test.ts`, `src/index.ts`
- Rollback concern: reverting this checkpoint would move CLI dispatch and top-level error handling back into `src/index.ts` and lose the focused entrypoint boundary tests that now protect direct execution and routing.
- Last focused command: `npx tsx --test src/cli/entrypoint.test.ts`; `npx tsx --test src/cli/entrypoint.test.ts src/index.test.ts src/cli/*.test.ts`; `npm install`; `npm run build`; `git push -u origin codex/issue-618`; `gh pr create --draft --base main --head codex/issue-618 ...`
### Scratchpad
- 2026-03-19 (JST): Pushed `codex/issue-618` to `origin` and opened draft PR #622 (`https://github.com/TommyKammy/codex-supervisor/pull/622`) after the CLI facade extraction checkpoint passed focused verification and `npm run build`.
- 2026-03-19 (JST): Reproduced the entrypoint extraction need with a new `src/cli/entrypoint.test.ts` failure (`Cannot find module './entrypoint'`), extracted `runCli(...)` and `runCliMain(...)` into `src/cli/entrypoint.ts`, fixed the temporary direct-execution regression by passing `src/index.ts`'s `__filename` into `isDirectExecution(...)`, and reran focused verification with `npx tsx --test src/cli/entrypoint.test.ts src/index.test.ts src/cli/*.test.ts` plus `npm run build` after `npm install`.
- 2026-03-19 (JST): Reran focused verification for the supervisor runtime extraction with `npx tsx --test src/cli/supervisor-runtime.test.ts src/index.test.ts` and `npm run build`, pushed `codex/issue-617` to `origin`, and opened draft PR #621 (`https://github.com/TommyKammy/codex-supervisor/pull/621`).
- 2026-03-19 (JST): Addressed CodeRabbit threads `PRRT_kwDORgvdZ851W7DO` and `PRRT_kwDORgvdZ851W7DQ` by resolving the default replay-corpus path inside the extracted handler layer and by skipping config loading on the missing-`caseId` advisory branch. Focused verification passed with `npx tsx --test src/cli/replay-handlers.test.ts src/index.test.ts` and `npm run build`.
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
