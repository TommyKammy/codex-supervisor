# Issue #690: Issue authoring diagnostics: warn when a child issue depends directly on its Epic

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/690
- Branch: codex/issue-690
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: a953754b52475f7ab447b9382ebdc865629080c4
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-20T05:55:44.523Z

## Latest Codex Summary
- Reproduced the missing epic-dependency diagnostic with focused `issue-metadata` and `issue-lint` tests, then taught `validateIssueMetadataSyntax(...)` to flag `Part of: #X` plus `Depends on: #X` as a concise local metadata warning without affecting valid sibling dependencies. Focused verification passed and `npm run build` passed after restoring local dev dependencies with `npm install`.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the narrowest safe fix for #690 is to keep the change inside `validateIssueMetadataSyntax(...)`, because `issue-lint` already exposes metadata diagnostics directly and this issue only needs a deterministic local warning for `Part of` plus the same `Depends on` epic.
- What changed: added focused regression coverage in `src/issue-metadata/issue-metadata.test.ts` for both the warning case (`Part of: #123` with `Depends on: #123, #77`) and a valid sibling-dependency case (`Depends on: #77, #88`). Added `src/supervisor/supervisor-diagnostics-issue-lint-metadata.test.ts` coverage asserting `issue-lint` reports the new warning. Updated `src/issue-metadata/issue-metadata-validation.ts` so `depends on` emits `depends on duplicates parent epic #<number>; remove it and keep only real blocking issues` when a child issue depends directly on a different parent epic.
- Current blocker: none
- Next exact step: review the staged diff for concision, commit the issue-lint diagnostic checkpoint on `codex/issue-690`, and open/update the draft PR if needed.
- Verification gap: none for the requested acceptance criteria. Focused validator and issue-lint tests passed, and `npm run build` passed after restoring local dev dependencies with `npm install`.
- Files touched: `src/issue-metadata/issue-metadata-validation.ts`, `src/issue-metadata/issue-metadata.test.ts`, `src/supervisor/supervisor-diagnostics-issue-lint-metadata.test.ts`, `.codex-supervisor/issue-journal.md`
- Rollback concern: reverting this checkpoint would remove the only local deterministic warning that catches child issues being blocked behind their parent epic, reopening the issue-authoring failure that #690 is meant to prevent.
- Last focused command: `npm run build`
- Last focused commands: `npx tsx --test src/issue-metadata/issue-metadata.test.ts`; `npx tsx --test src/supervisor/supervisor-diagnostics-issue-lint-metadata.test.ts`; `npm install`; `npm run build`
### Scratchpad
- 2026-03-20 (JST): Pushed `codex/issue-671` to `origin/codex/issue-671` and opened draft PR #676 (`https://github.com/TommyKammy/codex-supervisor/pull/676`) after the focused artifact/finalize/result/status/policy tests and `npm run build` were already green locally.
- 2026-03-20 (JST): Pushed `codex/issue-660` and opened draft PR #667 (`https://github.com/TommyKammy/codex-supervisor/pull/667`) after the focused doctor/state-store verification and build had already passed locally.
- 2026-03-20 (JST): Validated CodeRabbit thread `PRRT_kwDORgvdZ851kRrS` as a real bug: malformed SQLite rows could yield only `load_findings`, after which `loadFromSqlite()` returned fallback empty/bootstrap state without those findings. Fixed the fallback path, added a dedicated regression for the empty-state case, and reran `npx tsx --test src/core/state-store.test.ts` plus `npm run build` successfully.
- 2026-03-19 (JST): Pushed `codex/issue-559` and opened draft PR #582 (`https://github.com/TommyKammy/codex-supervisor/pull/582`) after the focused hinting slice passed local verification.
- 2026-03-19 (JST): Reproduced issue #559 with a focused `replay-corpus-promote` regression that expected advisory hints for `stale-head-prevents-merge` but only saw the existing explicit-case-id guidance and suggestions. Fixed it by adding deterministic `deriveReplayCorpusPromotionWorthinessHints(...)` coverage for stale-head safety, provider waits, and retry escalation, then surfacing those hints in both CLI suggestion mode and successful promotion summaries. Focused verification passed with `npx tsx --test src/index.test.ts --test-name-pattern "replay-corpus-promote"`, `npx tsx --test src/supervisor/replay-corpus.test.ts --test-name-pattern "PromotionWorthinessHints|promoteCapturedReplaySnapshot|checked-in safety case bundles|runReplayCorpus replays the checked-in PR lifecycle safety cases without mismatches"`, and `npm run build` after restoring local dev dependencies via `npm install`.
- 2026-03-19 (JST): Reproduced issue #558 with a tightened CLI promotion regression that failed because stdout only contained `Promoted replay corpus case ...`; fixed it by printing case path, compact expected outcome, and conditional volatile-field normalization notes after promotion. Focused verification passed with `npx tsx --test src/index.test.ts`, `npx tsx --test src/supervisor/replay-corpus.test.ts`, and `npm run build` after restoring local dev dependencies via `npm install`.
- 2026-03-19 (JST): Addressed CodeRabbit thread `PRRT_kwDORgvdZ851N_xt` by guarding replay corpus case-id suggestion derivation in `src/index.ts`; focused verification passed with `npx tsx --test src/index.test.ts` and `npm run build`.
- 2026-03-19 (JST): Added focused parser coverage for `replay-corpus-promote` plus an end-to-end CLI promotion regression in `src/index.test.ts`; the initial missing behavior was that the CLI had no dedicated promotion entry path at all.
- 2026-03-19 (JST): Implemented `replay-corpus-promote` in `src/index.ts` and extended `CliOptions` in `src/core/types.ts` with explicit `caseId` support; the new CLI path uses the existing `promoteCapturedReplaySnapshot(...)` implementation and defaults `corpusPath` to checked-in `replay-corpus`.
- 2026-03-19 (JST): Focused verification passed with `npx tsx --test src/index.test.ts src/supervisor/replay-corpus.test.ts`; `npm run build` first failed because `tsc` was missing locally, so ran `npm install` and reran `npm run build` successfully.
- 2026-03-19 (JST): Added `suggestReplayCorpusCaseIds(...)` with deterministic issue/state and normalized-title candidates, plus focused helper coverage in `src/supervisor/replay-corpus.test.ts`.
- 2026-03-19 (JST): Relaxed `parseArgs(...)` so `replay-corpus-promote <snapshotPath>` reaches `main()`, where the CLI now loads the snapshot and prints suggested case ids instead of failing before operators can see naming guidance.
