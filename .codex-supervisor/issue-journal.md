# Issue #656: GitHub timeout robustness: classify timeout-shaped failures consistently in transport retry handling

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/656
- Branch: codex/issue-656
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 78b403ef90f3ad4236fa49b01a6a38b9a8f3af88
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-19T16:36:19.334Z

## Latest Codex Summary
- None yet.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the narrowest safe fix is still the GitHub transport classifier; timeout-shaped `gh` failures should enter the same transient retry/terminal path as other network-shaped transport failures.
- What changed: inspected `src/github/github-transport.ts`, `src/github/github-transport.test.ts`, and `src/core/command.ts` to compare the transport classifier against the timeout message shape emitted by `runCommand(...)`. Added focused regressions in `src/github/github-transport.test.ts` for one retried timeout-shaped failure and one terminal timeout-shaped failure. The new tests failed first because `GitHubTransport` surfaced raw `Command timed out: gh ...` errors instead of retrying, and the terminal assertion saw the unwrapped timeout message rather than `Transient GitHub CLI failure after 3 attempts: ...`. Updated `src/github/github-transport.ts` so transient classification now recognizes timeout-shaped `gh` failures consistently via `command timed out`, `timed out after`, `request canceled`, and `context deadline exceeded`, while preserving the existing GitHub-related guard and non-transient behavior. Restored local dev dependencies with `npm install` because `npm run build` initially failed with `sh: 1: tsc: not found`, then reran the focused transport test and build successfully.
- Current blocker: none
- Next exact step: commit the focused timeout-classification checkpoint, push `codex/issue-656`, and open a draft PR so CI can validate the transport retry slice.
- Verification gap: none for the stated issue scope; I ran the focused GitHub transport tests plus `npm run build`, but not the full repository test suite because the issue calls for focused transport verification and build only.
- Files touched: `src/github/github-transport.ts`, `src/github/github-transport.test.ts`, `.codex-supervisor/issue-journal.md`
- Rollback concern: reverting this checkpoint would send transport-generated timeout failures back through the generic command-error path, making retry behavior and terminal messaging inconsistent for equivalent GitHub timeouts.
- Last focused command: `git status --short --branch`; `rg -n "timeout|transient|retry|classif|GitHub transport|gh .*timeout|ETIMEDOUT|timed out|SIGTERM|deadline" src`; `sed -n '1,240p' src/github/github-transport.ts`; `sed -n '1,260p' src/github/github-transport.test.ts`; `sed -n '1,260p' src/core/command.ts`; `npx tsx --test src/github/github-transport.test.ts`; `npm install`; `npm run build`; `gh pr view --json number,state,isDraft,headRefName,baseRefName,url`
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
