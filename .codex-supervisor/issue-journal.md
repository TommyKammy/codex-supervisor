# Issue #659: State-store visibility: capture structured corruption findings during load

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/659
- Branch: codex/issue-659
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 2 (implementation=1, repair=1)
- Last head SHA: fa9267a024605614870f5707ce0496d08e363553
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ851kRrS
- Repeated failure signature count: 1
- Updated at: 2026-03-20T05:25:14+09:00

## Latest Codex Summary
Implemented the focused state-store slice for issue #659, then addressed the follow-up CodeRabbit review on SQLite fallback visibility. [`src/core/state-store.ts`](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-659/src/core/state-store.ts) now preserves `load_findings` when malformed SQLite rows collapse the loaded state to bootstrap or empty fallback, and [`src/core/state-store.test.ts`](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-659/src/core/state-store.test.ts) includes a regression that specifically covers that empty-state fallback path. The journal was updated in [`.codex-supervisor/issue-journal.md`](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-659/.codex-supervisor/issue-journal.md).

Summary: Preserved SQLite `load_findings` across empty/bootstrap fallback and added focused regression coverage for the review-reported corruption path.
State hint: addressing_review
Blocked reason: none
Tests: `npx tsx --test src/core/state-store.test.ts`; `npm run build`
Failure signature: PRRT_kwDORgvdZ851kRrS
Next action: Commit the verified review fix on `codex/issue-659`, push the branch, and resolve the PR thread.

## Active Failure Context
- Category: review
- Summary: 1 unresolved automated review thread(s) remain.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/666#discussion_r2962486122
- Details:
  - src/core/state-store.ts:163 _⚠️ Potential issue_ | _🟠 Major_ **Preserve SQLite `load_findings` when the loader falls back to bootstrap/empty state.** At Line 349–364, fallback returns can drop findings produced by `readSqliteState(...)` when malformed rows result in an otherwise “empty” loaded state. That hides corruption in a real parse-failure path. <details> <summary>💡 Suggested patch</summary> ```diff private async loadFromSqlite(): Promise<SupervisorStateFile> { @@ validateSqliteSchemaVersion(db); const currentState = readSqliteState(db); + const findings = currentState.load_findings ?? []; if (Object.keys(currentState.issues).length > 0 || currentState.activeIssueNumber !== null) { return currentState; } if (!this.options.bootstrapFilePath) { - return this.emptyState(); + return withLoadFindings(this.emptyState(), findings); } const bootstrapState = await readJsonStateFromFile(this.options.bootstrapFilePath); if (!bootstrapState) { - return this.emptyState(); + return withLoadFindings(this.emptyState(), findings); } await this.saveToSqlite(bootstrapState); - return bootstrapState; + return withLoadFindings(bootstrapState, findings); } finally { db.close(); } } ``` </details> Also applies to: 341-364 <details> <summary>🤖 Prompt for AI Agents</summary> ``` Verify each finding against the current code and only fix it if needed. In `@src/core/state-store.ts` around lines 158 - 163, The fallback path in the loader can return an empty state and drop findings created by readSqliteState, losing parse-failure diagnostics; update the code around withLoadFindings (the return that builds { activeIssueNumber, issues }) so that when readSqliteState produced any findings (e.g., a non-empty findings array or load_findings metadata), those findings are preserved and merged into the returned result instead of being discarded—detect findings returned by readSqliteState, combine them with any existing findings, and pass the merged findings into withLoadFindings so load_findings is not lost when the loader falls back to bootstrap/empty state. ``` </details> <!-- fingerprinting:phantom:poseidon:hawk --> <!-- This is an auto-generated comment by CodeRabbit -->

## Codex Working Notes
### Current Handoff
- Hypothesis: the review thread is valid because `readSqliteState(...)` can return only `load_findings` after malformed rows are skipped, and `loadFromSqlite()` was dropping those findings whenever it fell back to bootstrap or empty state.
- What changed: verified the current SQLite regression only covered the non-fallback path (`activeIssueNumber` stayed non-null), so it did not catch the review case. Updated [`src/core/state-store.ts`](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-659/src/core/state-store.ts) so `withLoadFindings(...)` merges existing findings and `loadFromSqlite()` reattaches `currentState.load_findings` when returning bootstrap or empty fallback. Added a focused regression in [`src/core/state-store.test.ts`](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-659/src/core/state-store.test.ts) that corrupts the only SQLite issue row while `activeIssueNumber` is `null`, proving the fallback state still surfaces the structured parse finding. Focused verification passed with the existing state-store test file and `npm run build`.
- Current blocker: none
- Next exact step: commit the review fix, push `codex/issue-659`, and resolve the CodeRabbit thread on PR #666.
- Verification gap: none for the stated review scope; I reran focused `src/core/state-store.test.ts` coverage plus `npm run build`, but not the full repository test suite because the issue guidance still calls for focused state-store verification and build only.
- Files touched: `src/core/state-store.ts`, `src/core/state-store.test.ts`, `.codex-supervisor/issue-journal.md`
- Rollback concern: reverting this checkpoint would reintroduce the visibility gap where malformed SQLite rows disappear from `load_findings` whenever the loader falls back to bootstrap or empty state.
- Last focused command: `git status --short --branch`; `sed -n '1,280p' src/core/state-store.ts`; `sed -n '1,360p' src/core/state-store.test.ts`; `rg -n "loadFromSqlite|emptyState|withLoadFindings|bootstrapFilePath" src/core/state-store.ts`; `sed -n '320,430p' src/core/state-store.ts`; `npx tsx --test src/core/state-store.test.ts`; `npm run build`
### Scratchpad
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
