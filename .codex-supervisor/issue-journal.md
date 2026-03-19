# Issue #618: Index refactor: slim src/index.ts into a thin facade

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/618
- Branch: codex/issue-618
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 2 (implementation=1, repair=1)
- Last head SHA: eab8dcc11ab2e7fe5099b5b8916aca1959986c3e
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ851XZoF
- Repeated failure signature count: 1
- Updated at: 2026-03-19T05:50:42Z

## Latest Codex Summary
Applied the pending CodeRabbit review nit in [.codex-supervisor/issue-journal.md](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-618/.codex-supervisor/issue-journal.md) by hyphenating `index-focused tests` in the working notes while leaving the saved external review quote verbatim. The CLI facade refactor itself remains unchanged: [src/cli/entrypoint.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-618/src/cli/entrypoint.ts) still owns CLI dispatch/error handling, and [src/index.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-618/src/index.ts) remains the thin direct-execution facade.

This review follow-up is wording-only, so I verified it with a focused search of the journal rather than rerunning code tests. Draft PR #622 remains open at https://github.com/TommyKammy/codex-supervisor/pull/622, and the only remaining unrelated worktree change is the pre-existing untracked `.codex-supervisor/replay/` directory.

Summary: Applied the journal-only review wording fix for PR #622 by hyphenating `index-focused tests` in the working notes
State hint: addressing_review
Blocked reason: none
Tests: `rg -n "index focused tests|index-focused tests" .codex-supervisor/issue-journal.md`
Failure signature: PRRT_kwDORgvdZ851XZoF
Next action: commit/push the journal wording fix to `codex/issue-618` and monitor PR #622 for thread resolution or further review feedback

## Active Failure Context
- Category: review
- Summary: 1 unresolved automated review thread(s) remain.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/622#discussion_r2958001648
- Details:
  - .codex-supervisor/issue-journal.md:37 _⚠️ Potential issue_ | _🟡 Minor_ **Minor grammar: use hyphen in compound adjective.** "index focused tests" → "index-focused tests" <details> <summary>🧰 Tools</summary> <details> <summary>🪛 LanguageTool</summary> [grammar] ~37-~37: Use a hyphen to join words. Context: ...rypoint.test.ts`, the existing CLI/index focused tests, and `npm run build` all p... (QB_NEW_EN_HYPHEN) </details> </details> <details> <summary>🤖 Prompt for AI Agents</summary> ``` Verify each finding against the current code and only fix it if needed. In @.codex-supervisor/issue-journal.md at line 37, Replace the compound adjective "index focused tests" with the hyphenated form "index-focused tests" in the issue journal entry so it reads "the existing CLI/index-focused tests"; update the exact phrase "index focused tests" wherever it appears (e.g., in the line containing "Verification gap: none after `src/cli/entrypoint.test.ts`, the existing CLI/index focused tests, and `npm run build` all passed locally.") to use the hyphenated version. ``` </details> <!-- fingerprinting:phantom:medusa:ocelot --> <!-- This is an auto-generated comment by CodeRabbit -->

## Codex Working Notes
### Current Handoff
- Hypothesis: the only remaining unresolved review note is the journal wording nit, so no CLI or test changes are needed beyond correcting the hyphenated compound adjective in the handoff text.
- What changed: updated the working-notes sentence to say `CLI/index-focused tests`; kept the saved external review quote unchanged because it records the original reviewer text verbatim.
- Current blocker: none
- Next exact step: commit/push the journal-only review fix, then monitor PR #622 until the CodeRabbit thread clears or new review feedback appears.
- Verification gap: none; the wording-only change was checked by searching the journal for remaining unhyphenated non-quoted occurrences.
- Files touched: `.codex-supervisor/issue-journal.md`
- Rollback concern: reverting this checkpoint would only reintroduce the journal wording nit and reopen the review thread.
- Last focused command: `rg -n "index focused tests|index-focused tests" .codex-supervisor/issue-journal.md`; `git diff -- .codex-supervisor/issue-journal.md`
### Scratchpad
- 2026-03-19 (JST): Addressed CodeRabbit thread `PRRT_kwDORgvdZ851XZoF` locally by hyphenating `index-focused tests` in the working-notes verification sentence after confirming the other match was only the saved external review quote.
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
