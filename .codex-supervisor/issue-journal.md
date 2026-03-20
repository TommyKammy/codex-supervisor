# Issue #685: Reconciliation visibility: emit a conservative warning for unusually long reconciliation cycles

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/685
- Branch: codex/issue-685
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 2 (implementation=1, repair=1)
- Last head SHA: 302a318e6ad9ac639c7288e45d7080ab19b76be1
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ851okoy
- Repeated failure signature count: 1
- Updated at: 2026-03-20T05:13:36.400Z

## Latest Codex Summary
Implemented the reconciliation visibility slice and pushed it on `codex/issue-685` in commit `302a318`. The change persists reconciliation cycle start time in the phase snapshot, and [`src/supervisor/supervisor.ts`](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-685/src/supervisor/supervisor.ts) now emits a non-blocking `reconciliation_warning=long_running ...` line once a cycle has been active for more than five minutes. The snapshot handling lives in [`src/supervisor/supervisor-reconciliation-phase.ts`](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-685/src/supervisor/supervisor-reconciliation-phase.ts), and the focused regression coverage is in [`src/supervisor/supervisor-diagnostics-status-selection.test.ts`](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-685/src/supervisor/supervisor-diagnostics-status-selection.test.ts).

Focused verification passed with `npx tsx --test src/supervisor/supervisor-diagnostics-status-selection.test.ts` and `npm run build`. I had to run `npm install` first because `typescript` was missing from this worktree, and I opened draft PR #692: https://github.com/TommyKammy/codex-supervisor/pull/692

Summary: Added a deterministic long-running reconciliation status warning, covered fresh vs long cycles with a focused test, built successfully, and opened draft PR #692.
State hint: draft_pr
Blocked reason: none
Tests: `npx tsx --test src/supervisor/supervisor-diagnostics-status-selection.test.ts`; `npm run build`
Failure signature: none
Next action: wait for CI and review feedback on PR #692, then address any follow-up if it appears

## Active Failure Context
- Category: review
- Summary: 1 unresolved automated review thread(s) remain.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/692#discussion_r2963988178
- Details:
  - src/supervisor/supervisor.ts:173 _⚠️ Potential issue_ | _🟡 Minor_ **Use a strict “exceeds threshold” boundary.** Line 171 warns at exactly 5 minutes; the requirement says warning should appear once reconciliation **exceeds** five minutes. Keep equality non-warning. <details> <summary>Boundary fix</summary> ```diff - if (elapsedMs < LONG_RECONCILIATION_WARNING_THRESHOLD_MS) { + if (elapsedMs <= LONG_RECONCILIATION_WARNING_THRESHOLD_MS) { return null; } ``` </details> <!-- suggestion_start --> <details> <summary>📝 Committable suggestion</summary> > ‼️ **IMPORTANT** > Carefully review the code before committing. Ensure that it accurately replaces the highlighted code, contains no missing lines, and has no issues with indentation. Thoroughly test & benchmark the code to ensure it meets the requirements. ```suggestion if (elapsedMs <= LONG_RECONCILIATION_WARNING_THRESHOLD_MS) { return null; } ``` </details> <!-- suggestion_end --> <details> <summary>🤖 Prompt for AI Agents</summary> ``` Verify each finding against the current code and only fix it if needed. In `@src/supervisor/supervisor.ts` around lines 171 - 173, The current check uses "if (elapsedMs < LONG_RECONCILIATION_WARNING_THRESHOLD_MS) return null;" which triggers a warning at exactly the threshold; change the boundary to be strict by guarding with "<=" so the code reads that if elapsedMs <= LONG_RECONCILIATION_WARNING_THRESHOLD_MS return null, ensuring warnings occur only when elapsedMs > LONG_RECONCILIATION_WARNING_THRESHOLD_MS (refer to elapsedMs and LONG_RECONCILIATION_WARNING_THRESHOLD_MS in supervisor.ts). ``` </details> <!-- fingerprinting:phantom:poseidon:hawk --> <!-- This is an auto-generated comment by CodeRabbit -->

## Codex Working Notes
### Current Handoff
- Hypothesis: the narrowest safe review fix for #685 is to preserve the existing visibility-only warning path while changing the threshold boundary so reconciliation warns only after elapsed time strictly exceeds five minutes.
- What changed: validated CodeRabbit thread `PRRT_kwDORgvdZ851okoy` as a real boundary bug, changed `buildLongReconciliationWarning(...)` in `src/supervisor/supervisor.ts` to return `null` when `elapsedMs <= LONG_RECONCILIATION_WARNING_THRESHOLD_MS`, tightened `src/supervisor/supervisor-diagnostics-status-selection.test.ts` to assert no warning at exactly five minutes and a warning at five minutes plus one second, committed the fix as `45d9615`, pushed `codex/issue-685`, and resolved the PR #692 review thread in GitHub.
- Current blocker: none
- Next exact step: monitor PR #692 for any follow-up review or CI regression; otherwise proceed toward merge once the updated branch is re-evaluated.
- Verification gap: none for this review fix. `npx tsx --test src/supervisor/supervisor-diagnostics-status-selection.test.ts` and `npm run build` passed locally after the boundary update.
- Files touched: `src/supervisor/supervisor.ts`, `src/supervisor/supervisor-diagnostics-status-selection.test.ts`, `.codex-supervisor/issue-journal.md`
- Rollback concern: reverting this checkpoint would reintroduce a mismatch between the operator-visible warning and the acceptance text that says reconciliation must exceed the five-minute threshold before warning.
- Last focused commands: `npx tsx --test src/supervisor/supervisor-diagnostics-status-selection.test.ts`; `npm run build`
### Scratchpad
- 2026-03-20 (JST): Addressed CodeRabbit thread `PRRT_kwDORgvdZ851okoy` by making the long-reconciliation warning boundary strict (`>` only) and extending the diagnostics test to keep the exact five-minute case non-warning; focused verification passed with `npx tsx --test src/supervisor/supervisor-diagnostics-status-selection.test.ts` and `npm run build`.
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
