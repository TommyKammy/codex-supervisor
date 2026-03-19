# Issue #636: Command error hygiene: add redacted command rendering for failure and timeout errors

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/636
- Branch: codex/issue-636
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: aeaa38b86e47b3984b9bd693b52e73f42b3e92d9
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-19T12:44:17.592Z

## Latest Codex Summary
- Reproduced the raw-argument leak in `runCommand(...)` with focused core tests, then switched timeout and non-zero errors to a deterministic summarized command renderer that keeps the command plus the first two args and replaces the remainder with `+N arg(s)`. Reused the same renderer in GitHub transport sanitization, verified with `npx tsx --test src/core/command.test.ts src/github/github-transport.test.ts` plus `npm run build` after restoring local dev dependencies via `npm install`, committed the change as `5bb08a4`, pushed `codex/issue-636`, and opened draft PR #639.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the narrowest safe fix is to change only how `runCommand(...)` renders commands in thrown timeout and non-zero errors, so callers keep the same execution semantics while failure messages stop echoing full raw argument lists by default.
- What changed: added `src/core/command.test.ts` to reproduce both the non-zero-exit and timeout leaks with sentinel secret arguments, then updated `src/core/command.ts` to use a shared `renderCommandSummary(...)` helper for timeout and failure errors as well as the timeout line appended to `stderr`. Reused the same helper in `src/github/github-transport.ts` so transient GitHub sanitization stays aligned with the core summary shape.
- Current blocker: none
- Next exact step: monitor draft PR #639 and address any CI or review feedback if it appears.
- Verification gap: focused coverage for the core command runner and GitHub transport passed locally, and `npm run build` passed after `npm install`; I did not run the repository-wide `npm test` because the issue asked for focused command-runner coverage plus build verification.
- Files touched: `src/core/command.ts`, `src/core/command.test.ts`, `src/github/github-transport.ts`, `.codex-supervisor/issue-journal.md`
- Rollback concern: reverting this checkpoint would restore raw argument echoing in thrown timeout and non-zero-exit errors, including the timeout marker appended to `stderr`.
- Last focused command: `npx tsx --test src/core/command.test.ts src/github/github-transport.test.ts`; `npm install`; `npm run build`; `git commit -m "Redact command summaries in runner errors"`; `git push -u origin codex/issue-636`; `gh pr create --draft --base main --head codex/issue-636 ...`
### Scratchpad
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
