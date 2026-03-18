# Issue #557: Replay corpus promotion: suggest normalized case ids during promotion

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/557
- Branch: codex/issue-557
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 2 (implementation=1, repair=1)
- Last head SHA: 55b2ad0d629944c3db02cbd10979df204cdb5e50
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ851N_xt
- Repeated failure signature count: 1
- Updated at: 2026-03-18T16:23:32.718Z

## Latest Codex Summary
Implemented deterministic replay corpus case-id suggestions and surfaced them in the CLI when `replay-corpus-promote` is run without an explicit `caseId`. The promotion write path still requires an explicit operator-chosen id; the new behavior prints normalized suggestions such as `issue-557-reproducing` and a title-based fallback instead of failing before showing any guidance.

Focused coverage was added in [src/supervisor/replay-corpus.test.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-557/src/supervisor/replay-corpus.test.ts) and [src/index.test.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-557/src/index.test.ts), with implementation in [src/supervisor/replay-corpus.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-557/src/supervisor/replay-corpus.ts) and [src/index.ts](/home/tommy/Dev/codex-supervisor-self-worktrees/issue-557/src/index.ts). I updated the issue journal, committed the change as `55b2ad0` (`Suggest replay corpus case ids during promotion`), pushed `codex/issue-557`, and opened draft PR #580: https://github.com/TommyKammy/codex-supervisor/pull/580

Summary: Added deterministic replay corpus case-id suggestions, exposed them through `replay-corpus-promote` when `caseId` is omitted, verified with focused tests and `npm run build`, and opened draft PR #580.
State hint: draft_pr
Blocked reason: none
Tests: `npx tsx --test src/index.test.ts src/supervisor/replay-corpus.test.ts`; `npm install`; `npm run build`
Failure signature: none
Next action: Monitor PR #580 CI/results and address any review or verification failures.

## Active Failure Context
- Category: review
- Summary: 1 unresolved automated review thread(s) remain.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/580#discussion_r2954659260
- Details:
  - src/index.ts:205 _⚠️ Potential issue_ | _🟡 Minor_ **Guard suggestion derivation for malformed snapshots.** This path assumes `issue.number` and `decision.nextState` exist. If a snapshot passes schema-version parsing but is structurally incomplete, `suggestReplayCorpusCaseIds` can throw and skip this friendly guidance path. <details> <summary>💡 Suggested defensive handling</summary> ```diff if (options.caseId === undefined) { const snapshot = await loadSupervisorCycleDecisionSnapshot(options.snapshotPath!); - const suggestions = suggestReplayCorpusCaseIds(snapshot); + let suggestions: string[] = []; + try { + suggestions = suggestReplayCorpusCaseIds(snapshot); + } catch { + console.error("Unable to derive case-id suggestions from the snapshot. Provide an explicit case id."); + } console.error("The replay-corpus-promote command requires an explicit case id to write a new case."); if (suggestions.length > 0) { console.error("Suggested case ids:"); for (const suggestion of suggestions) { console.error(`- ${suggestion}`); ``` </details> <!-- suggestion_start --> <details> <summary>📝 Committable suggestion</summary> > ‼️ **IMPORTANT** > Carefully review the code before committing. Ensure that it accurately replaces the highlighted code, contains no missing lines, and has no issues with indentation. Thoroughly test & benchmark the code to ensure it meets the requirements. ```suggestion if (options.caseId === undefined) { const snapshot = await loadSupervisorCycleDecisionSnapshot(options.snapshotPath!); let suggestions: string[] = []; try { suggestions = suggestReplayCorpusCaseIds(snapshot); } catch { console.error("Unable to derive case-id suggestions from the snapshot. Provide an explicit case id."); } console.error("The replay-corpus-promote command requires an explicit case id to write a new case."); if (suggestions.length > 0) { console.error("Suggested case ids:"); for (const suggestion of suggestions) { console.error(`- ${suggestion}`); } } process.exitCode = 1; return; } ``` </details> <!-- suggestion_end --> <details> <summary>🤖 Prompt for AI Agents</summary> ``` Verify each finding against the current code and only fix it if needed. In `@src/index.ts` around lines 193 - 205, The code currently assumes loadSupervisorCycleDecisionSnapshot(options.snapshotPath!) returns a well-formed snapshot and that suggestReplayCorpusCaseIds(snapshot) will not throw; wrap the suggestion derivation in a defensive block: call loadSupervisorCycleDecisionSnapshot and then guard the snapshot shape (or catch exceptions) before calling suggestReplayCorpusCaseIds, and if anything fails just log the main error message and skip printing suggestions (or log a single “could not derive suggestions” message) rather than allowing an exception to propagate; update the block around options.caseId, loadSupervisorCycleDecisionSnapshot, and suggestReplayCorpusCaseIds to use try/catch and null/shape checks so malformed snapshots don’t crash this friendly guidance path. ``` </details> <!-- fingerprinting:phantom:poseidon:hawk --> <!-- This is an auto-generated comment by CodeRabbit -->

## Codex Working Notes
### Current Handoff
- Hypothesis: CodeRabbit's malformed-snapshot review finding is valid because the missing-case-id CLI guidance path loaded a schema-version-valid snapshot and then called `suggestReplayCorpusCaseIds(...)` without guarding missing `issue`/`decision` fields.
- What changed: wrapped `suggestReplayCorpusCaseIds(...)` in a defensive `try/catch` in `src/index.ts` so malformed snapshots still print the explicit-case-id guidance without crashing; added a focused CLI regression in `src/index.test.ts` that omits `decision` from the snapshot payload and verifies the fallback stderr path.
- Current blocker: none
- Next exact step: commit this review repair, push `codex/issue-557`, and resolve the CodeRabbit thread on PR #580.
- Verification gap: broader full-suite verification has still not been run; this repair was checked with `npx tsx --test src/index.test.ts` and `npm run build`.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/index.ts`, `src/index.test.ts`
- Rollback concern: removing the defensive catch would reintroduce a crash in the operator-guidance-only path for snapshots that parse but omit required nested fields.
- Last focused command: `npx tsx --test src/index.test.ts`; `npm run build`
### Scratchpad
- 2026-03-19 (JST): Addressed CodeRabbit thread `PRRT_kwDORgvdZ851N_xt` by guarding replay corpus case-id suggestion derivation in `src/index.ts`; focused verification passed with `npx tsx --test src/index.test.ts` and `npm run build`.
- 2026-03-19 (JST): Added focused parser coverage for `replay-corpus-promote` plus an end-to-end CLI promotion regression in `src/index.test.ts`; the initial missing behavior was that the CLI had no dedicated promotion entry path at all.
- 2026-03-19 (JST): Implemented `replay-corpus-promote` in `src/index.ts` and extended `CliOptions` in `src/core/types.ts` with explicit `caseId` support; the new CLI path uses the existing `promoteCapturedReplaySnapshot(...)` implementation and defaults `corpusPath` to checked-in `replay-corpus`.
- 2026-03-19 (JST): Focused verification passed with `npx tsx --test src/index.test.ts src/supervisor/replay-corpus.test.ts`; `npm run build` first failed because `tsc` was missing locally, so ran `npm install` and reran `npm run build` successfully.
- 2026-03-19 (JST): Added `suggestReplayCorpusCaseIds(...)` with deterministic issue/state and normalized-title candidates, plus focused helper coverage in `src/supervisor/replay-corpus.test.ts`.
- 2026-03-19 (JST): Relaxed `parseArgs(...)` so `replay-corpus-promote <snapshotPath>` reaches `main()`, where the CLI now loads the snapshot and prints suggested case ids instead of failing before operators can see naming guidance.
