# Issue #573: Issue authoring diagnostics: validate dependency and sequencing metadata syntax and local consistency in issue lint

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/573
- Branch: codex/issue-573
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 4 (implementation=2, repair=2)
- Last head SHA: 36ed9caecc8120e0f899c77a61437017159c77f5
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ851RTo3
- Repeated failure signature count: 1
- Updated at: 2026-03-18T19:47:45.000Z

## Latest Codex Summary
Patched [issue-metadata-validation.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-573/src/issue-metadata/issue-metadata-validation.ts#L64) so `validateIssueMetadataSyntax(...)` treats a blank `Execution order:` line as present metadata that must parse as `N of M`, instead of silently skipping validation. I extended the existing zero/blank regression in [issue-metadata.test.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-573/src/issue-metadata/issue-metadata.test.ts#L119) to include `Execution order:` with no value and assert the expected syntax error.

Local verification passed with `npx tsx --test src/issue-metadata/issue-metadata.test.ts src/supervisor/supervisor-diagnostics-issue-lint.test.ts` and `npm run build`.

Summary: Fixed the remaining blank `Execution order:` review gap in the validator and regression test
State hint: local_review_fix
Blocked reason: none
Tests: `npx tsx --test src/issue-metadata/issue-metadata.test.ts src/supervisor/supervisor-diagnostics-issue-lint.test.ts`; `npm run build`
Failure signature: PRRT_kwDORgvdZ851RTo3
Next action: Commit and push the blank execution-order review fix, then resolve the remaining CodeRabbit thread on PR #589

## Active Failure Context
- Category: review
- Summary: 1 unresolved automated review thread(s) remain.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/589#discussion_r2955810744
- Details:
  - src/issue-metadata/issue-metadata.test.ts:132 _⚠️ Potential issue_ | _🟠 Major_ **Add blank `Execution order:` regression coverage.** At **Line 119**, the test title says “blank scheduling metadata values,” but blank execution-order isn’t covered. Given the current validator gating, `Execution order:` with no value can be missed. Please include it in this case. <details> <summary>🧪 Proposed test update</summary> ```diff test("validateIssueMetadataSyntax rejects zero and blank scheduling metadata values", () => { const issue = createIssue({ number: 55, body: `Part of: `#0` Depends on: +Execution order: Parallelizable:`, }); assert.deepEqual(validateIssueMetadataSyntax(issue), [ "part of must reference a single issue as #<number>", "depends on must be none or comma-separated #<number> references", + "execution order must be N of M with 1 <= N <= M", "parallelizable must be Yes or No", ]); }); ``` </details> <!-- suggestion_start --> <details> <summary>📝 Committable suggestion</summary> > ‼️ **IMPORTANT** > Carefully review the code before committing. Ensure that it accurately replaces the highlighted code, contains no missing lines, and has no issues with indentation. Thoroughly test & benchmark the code to ensure it meets the requirements. ```suggestion test("validateIssueMetadataSyntax rejects zero and blank scheduling metadata values", () => { const issue = createIssue({ number: 55, body: `Part of: `#0` Depends on: Execution order: Parallelizable:`, }); assert.deepEqual(validateIssueMetadataSyntax(issue), [ "part of must reference a single issue as #<number>", "depends on must be none or comma-separated #<number> references", "execution order must be N of M with 1 <= N <= M", "parallelizable must be Yes or No", ]); }); ``` </details> <!-- suggestion_end --> <details> <summary>🤖 Prompt for AI Agents</summary> ``` Verify each finding against the current code and only fix it if needed. In `@src/issue-metadata/issue-metadata.test.ts` around lines 119 - 132, The test "validateIssueMetadataSyntax rejects zero and blank scheduling metadata values" is missing coverage for a blank "Execution order:" field; update the test (in the same test case that calls validateIssueMetadataSyntax) to include "Execution order:" in the issue body and add the corresponding expected error string (e.g. "execution order must be an integer") to the array of expected validation messages so validateIssueMetadataSyntax is asserted to reject an empty Execution order. ``` </details> <!-- fingerprinting:phantom:poseidon:hawk --> <!-- This is an auto-generated comment by CodeRabbit -->

## Codex Working Notes
### Current Handoff
- Hypothesis: the remaining CodeRabbit thread is valid because `validateIssueMetadataSyntax(...)` only checked execution order when the line had a non-empty value, so `Execution order:` by itself bypassed syntax validation.
- What changed: broadened execution-order presence detection to match blank single-line metadata, then extended the existing zero/blank scheduling regression to include an empty `Execution order:` line and the corresponding validation error.
- Current blocker: none
- Next exact step: commit the validator/test change, push `codex/issue-573`, and resolve CodeRabbit thread `PRRT_kwDORgvdZ851RTo3` if GitHub reflects the updated diff cleanly.
- Verification gap: none; the focused issue-metadata and issue-lint tests plus `npm run build` pass locally after the blank execution-order fix.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/issue-metadata/issue-metadata-validation.ts`, `src/issue-metadata/issue-metadata.test.ts`
- Rollback concern: reverting this change would reintroduce a blind spot where blank `Execution order:` metadata passes lint without any author-facing diagnostic.
- Last focused command: `npx tsx --test src/issue-metadata/issue-metadata.test.ts src/supervisor/supervisor-diagnostics-issue-lint.test.ts`; `npm run build`
### Scratchpad
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
