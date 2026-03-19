# Issue #655: GitHub timeout robustness: add a conservative default timeout for transport calls

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/655
- Branch: codex/issue-655
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: dcb3ac27de0a06949d466d42c7f5a5561d6b149c
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-19T16:15:13.026Z

## Latest Codex Summary
- Reproduced the missing GitHub transport timeout with a focused `src/github/github-transport.test.ts` assertion, then fixed `GitHubTransport.run(...)` to apply a default `60_000ms` timeout only when callers omit `timeoutMs`; explicit caller overrides still win. Focused transport tests and `npm run build` now pass after restoring local dev dependencies with `npm install`.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the narrowest safe fix is the GitHub transport itself; it should inject a deterministic default timeout for every `gh` call unless a caller already provided `timeoutMs`.
- What changed: inspected `src/github/github-transport.ts`, `src/github/github-transport.test.ts`, `src/github/github.ts`, and `src/core/command.ts` to confirm that transport calls currently forward `options` unchanged. Added focused regression coverage in `src/github/github-transport.test.ts` for the default-timeout path and the explicit override path. The new default-timeout test failed first with `AssertionError [ERR_ASSERTION]: actual undefined !== expected 60000`, proving omitted calls reached the command runner without `timeoutMs`. Updated `src/github/github-transport.ts` to apply `60_000ms` only when `options.timeoutMs` is absent, preserving other caller options and all explicit timeout overrides. Restored local dev dependencies with `npm install` because `npm run build` initially failed with `sh: 1: tsc: not found`, then reran the focused test and build successfully.
- Current blocker: none
- Next exact step: commit this timeout transport checkpoint on `codex/issue-655`, then open or update the draft PR for issue #655 if one does not already exist.
- Verification gap: none for the stated issue scope; I ran the focused GitHub transport tests plus `npm run build`, but not the full repository test suite because the issue calls for focused transport verification and build only.
- Files touched: `src/github/github-transport.ts`, `src/github/github-transport.test.ts`, `.codex-supervisor/issue-journal.md`
- Rollback concern: reverting this checkpoint would return GitHub transport calls to caller-by-caller timeout coverage, leaving any omitted `timeoutMs` transport path unbounded again.
- Last focused command: `git status --short --branch`; `rg -n "timeout|gh\\s|GitHub transport|transport" src .`; `rg --files | rg "github|gh|transport|octokit"`; `sed -n '1,260p' src/github/github-transport.ts`; `sed -n '1,260p' src/github/github-transport.test.ts`; `sed -n '1,220p' src/github/github.ts`; `sed -n '1,260p' src/core/command.ts`; `npx tsx --test src/github/github-transport.test.ts`; `npm install`; `npm run build`
### Scratchpad
- 2026-03-19 (JST): Pushed `codex/issue-559` and opened draft PR #582 (`https://github.com/TommyKammy/codex-supervisor/pull/582`) after the focused hinting slice passed local verification.
- 2026-03-19 (JST): Reproduced issue #559 with a focused `replay-corpus-promote` regression that expected advisory hints for `stale-head-prevents-merge` but only saw the existing explicit-case-id guidance and suggestions. Fixed it by adding deterministic `deriveReplayCorpusPromotionWorthinessHints(...)` coverage for stale-head safety, provider waits, and retry escalation, then surfacing those hints in both CLI suggestion mode and successful promotion summaries. Focused verification passed with `npx tsx --test src/index.test.ts --test-name-pattern "replay-corpus-promote"`, `npx tsx --test src/supervisor/replay-corpus.test.ts --test-name-pattern "PromotionWorthinessHints|promoteCapturedReplaySnapshot|checked-in safety case bundles|runReplayCorpus replays the checked-in PR lifecycle safety cases without mismatches"`, and `npm run build` after restoring local dev dependencies via `npm install`.
- 2026-03-19 (JST): Reproduced issue #558 with a tightened CLI promotion regression that failed because stdout only contained `Promoted replay corpus case ...`; fixed it by printing case path, compact expected outcome, and conditional volatile-field normalization notes after promotion. Focused verification passed with `npx tsx --test src/index.test.ts`, `npx tsx --test src/supervisor/replay-corpus.test.ts`, and `npm run build` after restoring local dev dependencies via `npm install`.
- 2026-03-19 (JST): Addressed CodeRabbit thread `PRRT_kwDORgvdZ851N_xt` by guarding replay corpus case-id suggestion derivation in `src/index.ts`; focused verification passed with `npx tsx --test src/index.test.ts` and `npm run build`.
- 2026-03-19 (JST): Added focused parser coverage for `replay-corpus-promote` plus an end-to-end CLI promotion regression in `src/index.test.ts`; the initial missing behavior was that the CLI had no dedicated promotion entry path at all.
- 2026-03-19 (JST): Implemented `replay-corpus-promote` in `src/index.ts` and extended `CliOptions` in `src/core/types.ts` with explicit `caseId` support; the new CLI path uses the existing `promoteCapturedReplaySnapshot(...)` implementation and defaults `corpusPath` to checked-in `replay-corpus`.
- 2026-03-19 (JST): Focused verification passed with `npx tsx --test src/index.test.ts src/supervisor/replay-corpus.test.ts`; `npm run build` first failed because `tsc` was missing locally, so ran `npm install` and reran `npm run build` successfully.
- 2026-03-19 (JST): Added `suggestReplayCorpusCaseIds(...)` with deterministic issue/state and normalized-title candidates, plus focused helper coverage in `src/supervisor/replay-corpus.test.ts`.
- 2026-03-19 (JST): Relaxed `parseArgs(...)` so `replay-corpus-promote <snapshotPath>` reaches `main()`, where the CLI now loads the snapshot and prints suggested case ids instead of failing before operators can see naming guidance.
