# Issue #690: Issue authoring diagnostics: warn when a child issue depends directly on its Epic

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/690
- Branch: codex/issue-690
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 2 (implementation=1, repair=1)
- Last head SHA: f2c40f60415be27322c66b909399ef5737630428
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ851o-uu
- Repeated failure signature count: 1
- Updated at: 2026-03-20T06:10:35.204Z

## Latest Codex Summary
Validated CodeRabbit thread `PRRT_kwDORgvdZ851o-uu` as a real wording mismatch in the issue journal only. The implementation and tests already correctly warn when `Depends on` repeats the same epic listed in `Part of`; this turn updates `.codex-supervisor/issue-journal.md` to match that behavior and keep the review handoff accurate.

No code changes were required, so I did not rerun tests. This review-only fix is limited to the journal text in `.codex-supervisor/issue-journal.md`; the pre-existing untracked `.codex-supervisor/replay/` directory remains untouched.

Summary: Aligned the issue journal wording with the implemented same-epic `issue-lint` warning for PR #694 review feedback.
State hint: addressing_review
Blocked reason: none
Tests: not run (journal-only wording fix)
Failure signature: PRRT_kwDORgvdZ851o-uu
Next action: Commit and push the journal wording fix, then resolve or respond to CodeRabbit thread `PRRT_kwDORgvdZ851o-uu`.

## Active Failure Context
- Category: review
- Summary: 1 unresolved automated review thread(s) remain.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/694#discussion_r2964130102
- Details:
  - .codex-supervisor/issue-journal.md:25 _⚠️ Potential issue_ | _🟡 Minor_ **Correct the warning description to match implemented behavior.** Line 25 says the warning triggers when a child depends on a “different parent epic,” but the implemented rule warns when `Depends on` duplicates the **same** epic from `Part of`. Please align wording to prevent handoff confusion. <details> <summary>🤖 Prompt for AI Agents</summary> ``` Verify each finding against the current code and only fix it if needed. In @.codex-supervisor/issue-journal.md at line 25, Update the description on line 25 to reflect the implemented rule: change the phrase that says the warning triggers when a child depends on a “different parent epic” to state it triggers when `Depends on` duplicates the same epic listed in `Part of` (i.e., when a child issue lists the same parent epic in `Depends on`), so the journal entry matches the implemented message `depends on duplicates parent epic #<number>; remove it and keep only real blocking issues`. ``` </details> <!-- fingerprinting:phantom:poseidon:hawk --> <!-- This is an auto-generated comment by CodeRabbit -->

## Codex Working Notes
### Current Handoff
- Hypothesis: the narrowest safe fix for #690 is to keep the change inside `validateIssueMetadataSyntax(...)`, because `issue-lint` already exposes metadata diagnostics directly and this issue only needs a deterministic local warning for `Part of` plus the same `Depends on` epic.
- What changed: added focused regression coverage in `src/issue-metadata/issue-metadata.test.ts` for both the warning case (`Part of: #123` with `Depends on: #123, #77`) and a valid sibling-dependency case (`Depends on: #77, #88`). Added `src/supervisor/supervisor-diagnostics-issue-lint-metadata.test.ts` coverage asserting `issue-lint` reports the new warning. Updated `src/issue-metadata/issue-metadata-validation.ts` so `depends on` emits `depends on duplicates parent epic #<number>; remove it and keep only real blocking issues` when a child issue depends directly on the same parent epic listed in `Part of`.
- Current blocker: none
- Next exact step: commit and push the journal wording correction for PR #694, then resolve or respond to CodeRabbit thread `PRRT_kwDORgvdZ851o-uu`.
- Verification gap: none for the requested acceptance criteria. Focused validator and issue-lint tests passed, and `npm run build` passed after restoring local dev dependencies with `npm install`.
- Files touched: `src/issue-metadata/issue-metadata-validation.ts`, `src/issue-metadata/issue-metadata.test.ts`, `src/supervisor/supervisor-diagnostics-issue-lint-metadata.test.ts`, `.codex-supervisor/issue-journal.md`
- Rollback concern: reverting this checkpoint would remove the only local deterministic warning that catches child issues being blocked behind their parent epic, reopening the issue-authoring failure that #690 is meant to prevent.
- Last focused command: `git diff -- .codex-supervisor/issue-journal.md`
- Last focused commands: `sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-690/AGENTS.generated.md`; `sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-690/context-index.md`; `sed -n '1,260p' .codex-supervisor/issue-journal.md`; `rg -n "different parent epic|duplicates parent epic|same parent epic" .codex-supervisor/issue-journal.md src/issue-metadata/issue-metadata-validation.ts src/issue-metadata/issue-metadata.test.ts src/supervisor/supervisor-diagnostics-issue-lint-metadata.test.ts`; `git diff -- .codex-supervisor/issue-journal.md`
### Scratchpad
- 2026-03-20 (JST): Validated CodeRabbit thread `PRRT_kwDORgvdZ851o-uu` as a real journal wording mismatch only; corrected `.codex-supervisor/issue-journal.md` so the handoff text now says the warning fires when `Depends on` duplicates the same epic from `Part of`. No code changes or additional test runs were needed for this review-only fix.
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
