# Issue #573: Issue authoring diagnostics: validate dependency and sequencing metadata syntax and local consistency in issue lint

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/573
- Branch: codex/issue-573
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 4 (implementation=2, repair=2)
- Last head SHA: dfb03d94ad90c00fd3490066acefcbca88e42eaf
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ851RTo3
- Repeated failure signature count: 1
- Updated at: 2026-03-18T19:48:46.000Z

## Latest Codex Summary
Patched [issue-metadata-validation.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-573/src/issue-metadata/issue-metadata-validation.ts#L69) so `validateIssueMetadataSyntax(...)` treats a blank `Execution order:` line as present metadata that must parse as `N of M`, instead of silently skipping validation. I extended the existing zero/blank regression in [issue-metadata.test.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-573/src/issue-metadata/issue-metadata.test.ts#L119) to include `Execution order:` with no value and assert the expected syntax error.

The fix is committed as `dfb03d9` (`Catch blank execution order metadata`), pushed to `codex/issue-573`, and CodeRabbit thread `PRRT_kwDORgvdZ851RTo3` is resolved. Local verification passed with `npx tsx --test src/issue-metadata/issue-metadata.test.ts src/supervisor/supervisor-diagnostics-issue-lint.test.ts` and `npm run build`.

Summary: Fixed the remaining blank `Execution order:` review gap, pushed `dfb03d9`, and resolved the last open CodeRabbit thread on PR #589
State hint: addressing_review
Blocked reason: none
Tests: `npx tsx --test src/issue-metadata/issue-metadata.test.ts src/supervisor/supervisor-diagnostics-issue-lint.test.ts`; `npm run build`
Failure signature: none
Next action: Monitor PR #589 CI for the `dfb03d9` update and respond if any new review or integration feedback appears

## Active Failure Context
- Category: none
- Summary: No unresolved automated review threads remain after pushing `dfb03d9` and resolving `PRRT_kwDORgvdZ851RTo3`.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/589
- Details:
  - Waiting on CI rechecks for the branch update; no active local failure remains.

## Codex Working Notes
### Current Handoff
- Hypothesis: the remaining CodeRabbit thread is valid because `validateIssueMetadataSyntax(...)` only checked execution order when the line had a non-empty value, so `Execution order:` by itself bypassed syntax validation.
- What changed: broadened execution-order presence detection to match blank single-line metadata, then extended the existing zero/blank scheduling regression to include an empty `Execution order:` line and the corresponding validation error.
- Current blocker: none
- Next exact step: watch PR #589 checks for `dfb03d9` and respond only if new review or CI feedback appears.
- Verification gap: none; the focused issue-metadata and issue-lint tests plus `npm run build` passed before pushing `dfb03d9`.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/issue-metadata/issue-metadata-validation.ts`, `src/issue-metadata/issue-metadata.test.ts`
- Rollback concern: reverting this change would reintroduce a blind spot where blank `Execution order:` metadata passes lint without any author-facing diagnostic.
- Last focused command: `npx tsx --test src/issue-metadata/issue-metadata.test.ts src/supervisor/supervisor-diagnostics-issue-lint.test.ts`; `npm run build`
### Scratchpad
- 2026-03-19 (JST): Committed the blank execution-order fix as `dfb03d9` (`Catch blank execution order metadata`), pushed it to `codex/issue-573`, and resolved CodeRabbit thread `PRRT_kwDORgvdZ851RTo3` via `gh api graphql`.
- 2026-03-19 (JST): Validated CodeRabbit thread `PRRT_kwDORgvdZ851RTo3` as a real gap: the zero/blank scheduling test did not include `Execution order:`, and `validateIssueMetadataSyntax(...)` used `/^\\s*Execution order:\\s*.+$/im`, which skipped blank values. Fixed the gate to match blank execution-order lines, added the missing regression coverage, and reran `npx tsx --test src/issue-metadata/issue-metadata.test.ts src/supervisor/supervisor-diagnostics-issue-lint.test.ts` plus `npm run build`, all passing.
- 2026-03-19 (JST): Reproduced issue #573 with a focused `issue-lint` regression: an authored issue containing `Part of: #104`, duplicate/self `Depends on`, `Execution order: 3 of 2`, and `Parallelizable: Later` still reported `execution_ready=yes` and no metadata problems. Fixed it by adding local metadata validation and a `metadata_errors=` summary line, then verified with `npx tsx --test src/issue-metadata/issue-metadata.test.ts src/supervisor/supervisor-diagnostics-issue-lint.test.ts` and `npm run build` after restoring local deps via `npm install`.
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
