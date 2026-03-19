# Issue #618: Index refactor: slim src/index.ts into a thin facade

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/618
- Branch: codex/issue-618
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 3 (implementation=1, repair=2)
- Last head SHA: 5b5f5ffae750cfef7ab630dbb87b5b7aa61abe93
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ851Xel-|PRRT_kwDORgvdZ851XemD
- Repeated failure signature count: 1
- Updated at: 2026-03-19T05:59:59.762Z

## Latest Codex Summary
Reworked [.codex-supervisor/issue-journal.md](.codex-supervisor/issue-journal.md) so the latest summary uses repository-relative links and the saved CodeRabbit failure context is captured as structured thread summaries instead of a single-line markdown-heavy dump. No CLI code paths changed.

Summary: Applied the remaining PR #622 journal-only review fixes locally
State hint: local_review_fix
Blocked reason: none
Tests: `rg -n "index-focused tests" .codex-supervisor/issue-journal.md`; `! rg -n "\\]\\(/home/" .codex-supervisor/issue-journal.md`; `npx markdownlint-cli2 .codex-supervisor/issue-journal.md 2>&1 | rg "MD038"` (no output; full-file markdownlint still reports unrelated baseline warnings)
Failure signature: PRRT_kwDORgvdZ851Xel-|PRRT_kwDORgvdZ851XemD
Next action: commit/push the journal-only fix to `codex/issue-618`, then resolve or monitor the remaining PR #622 review threads

## Active Failure Context
- Category: review
- Summary: 2 automated review thread(s) were reproduced locally and addressed in the journal; the remote threads remain open until the fix is pushed and reviewed.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/622#discussion_r2958029013
- Details:
  - Thread `PRRT_kwDORgvdZ851Xel-` on `.codex-supervisor/issue-journal.md:17`: replace the committed absolute workstation link in the latest summary with a repository-relative link so the journal does not expose local filesystem paths.
  - Thread `PRRT_kwDORgvdZ851XemD` on `.codex-supervisor/issue-journal.md:33`: keep `index-focused tests` hyphenated and replace the single-line embedded review dump with stable multiline bullets so inline code remains readable and `MD038` noise is avoided.

## Codex Working Notes
### Current Handoff
- Hypothesis: the remaining review feedback is still journal-only, so no CLI or test changes are needed beyond removing the absolute journal link and normalizing the saved review context formatting.
- What changed: rewrote the latest-summary journal link as repository-relative and replaced the raw pasted CodeRabbit review bodies with thread-id summaries that preserve the actionable failure details without carrying markdownlint-hostile inline dumps.
- Current blocker: none
- Next exact step: commit/push the journal-only review fix, then resolve or monitor PR #622 review threads after the updated journal lands on the branch.
- Verification gap: none for the review-targeted signals; full-file markdownlint still has unrelated baseline warnings outside this journal-only fix.
- Files touched: `.codex-supervisor/issue-journal.md`
- Rollback concern: reverting this checkpoint would reintroduce the absolute-path leak and the markdownlint-prone saved review formatting in the journal.
- Last focused command: `! rg -n "\\]\\(/home/" .codex-supervisor/issue-journal.md`; `npx markdownlint-cli2 .codex-supervisor/issue-journal.md 2>&1 | rg "MD038"`
### Scratchpad
- 2026-03-19 (JST): Focused journal verification confirmed the absolute workstation path is gone and `MD038` no longer appears in markdownlint output for `.codex-supervisor/issue-journal.md`; full-file markdownlint still reports unrelated legacy style warnings across the journal.
- 2026-03-19 (JST): Reframed the remaining CodeRabbit failure context as structured thread summaries, rewrote the latest summary journal link to be repository-relative, and prepared focused markdown/journal verification for the journal-only review repair.
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
