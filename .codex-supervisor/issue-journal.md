# Issue #1008: Interrupted turn recovery: detect and reconcile in-progress Codex turns that end without a durable handoff

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1008
- Branch: codex/issue-1008
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 3 (implementation=2, repair=1)
- Last head SHA: 94686a4f3323c007a651284870ba313800efcf3d
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ852yHrV
- Repeated failure signature count: 1
- Updated at: 2026-03-25T17:02:29Z

## Latest Codex Summary
Addressed the open CodeRabbit review on PR [#1026](https://github.com/TommyKammy/codex-supervisor/pull/1026) by persisting a pre-run journal fingerprint in `turn-in-progress.json` and reconciling interrupted turns against the journal mutation instead of `record.updated_at`. Added a regression proving restart recovery no longer blocks `handoff_missing` when Codex already wrote the journal handoff before the supervisor saved state; the existing untracked `.codex-supervisor/pre-merge/` and `.codex-supervisor/replay/` directories remain local-only artifacts.

Summary: Replaced timestamp-based interrupted-turn recovery with a journal-fingerprint check and added the missing crash-window regression for PR `#1026`
State hint: addressing_review
Blocked reason: none
Tests: `npx tsx --test src/run-once-turn-execution.test.ts src/supervisor/supervisor-execution-orchestration.test.ts src/supervisor/supervisor-recovery-reconciliation.test.ts`; `npm run build`
Next action: commit the review fix, push `codex/issue-1008`, and update PR `#1026` for the unresolved review thread
Failure signature: none

## Active Failure Context
- Category: review
- Summary: 1 unresolved automated review thread(s) remain.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/1026#discussion_r2989660673
- Details:
  - src/recovery-reconciliation.ts:119 _⚠️ Potential issue_ | _🟠 Major_ **`updated_at` is not a reliable durable-handoff signal.** In `src/run-once-turn-execution.ts`, Lines 325-341 read `journalAfterRun` immediately after `agentRunner.runTurn()` and before any `stateStore.save()`. A crash in that window leaves a real handoff on disk while `record.updated_at` is still pre-turn, so this helper will drive restart reconciliation into a false `handoff_missing` block. Compare the journal mutation itself (mtime/hash/content), or persist a pre-run journal fingerprint in the marker, instead of using the record timestamp. <details> <summary>🤖 Prompt for AI Agents</summary> ``` Verify each finding against the current code and only fix it if needed. In `@src/recovery-reconciliation.ts` around lines 112 - 119, The helper hasDurableTurnUpdateSince should not rely on record.updated_at as a durable-handoff signal; update it to instead verify a journal-level durable marker: compare the journal file mutation (mtime/hash/content) or a persisted pre-run journal fingerprint stored in the run marker after agentRunner.runTurn(), rather than using record.updated_at. Specifically, modify the logic around hasDurableTurnUpdateSince and the code paths that call it (see journalAfterRun, agentRunner.runTurn, and stateStore.save) so the check reads the journal's mtime or verifies a saved fingerprint in the marker (or the journal content hash) to determine if the durable handoff was written to disk, and ensure the pre-run fingerprint is saved before running the turn so the post-run comparison is reliable. ``` </details> <!-- fingerprinting:phantom:medusa:grasshopper --> <!-- This is an auto-generated comment by CodeRabbit -->

## Codex Working Notes
### Current Handoff
- Hypothesis: the real false-positive window is between `agentRunner.runTurn()` and `stateStore.save()`; recovery must compare a durable journal mutation captured before the turn, not the in-memory record timestamp.
- What changed: extended `src/interrupted-turn-marker.ts` to persist a pre-run journal SHA-256 fingerprint, wrote that fingerprint into `turn-in-progress.json` from `src/run-once-turn-execution.ts`, updated `src/recovery-reconciliation.ts` to compare the current journal fingerprint during stale-active reconciliation with a timestamp fallback only for older markers, and added focused regressions in `src/run-once-turn-execution.test.ts` and `src/supervisor/supervisor-execution-orchestration.test.ts` covering both the blocked-no-handoff path and the journal-mutated crash window.
- Current blocker: none.
- Next exact step: commit this review fix, push the branch, and reply on PR `#1026` that interrupted-turn recovery now keys off the durable journal fingerprint instead of `updated_at`.
- Verification gap: none after `npx tsx --test src/run-once-turn-execution.test.ts src/supervisor/supervisor-execution-orchestration.test.ts src/supervisor/supervisor-recovery-reconciliation.test.ts` and `npm run build`.
- Files touched: `src/interrupted-turn-marker.ts`; `src/run-once-turn-execution.ts`; `src/recovery-reconciliation.ts`; `src/run-once-turn-execution.test.ts`; `src/supervisor/supervisor-execution-orchestration.test.ts`; `.codex-supervisor/issue-journal.md`.
- Rollback concern: low; the runtime change is limited to a supervisor-owned marker file plus restart reconciliation, but stale-marker handling now influences active-issue recovery and should not be partially reverted.
- Last focused command: `npm run build`
- Exact failure reproduced: with `turn-in-progress.json` present and `record.updated_at` still pre-turn, a restart would block `handoff_missing` even if Codex had already appended a durable journal handoff before the supervisor crashed.
- Commands run: `sed -n '1,220p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-1008/AGENTS.generated.md`; `sed -n '1,260p' /home/tommy/Dev/codex-supervisor-self/.local/memory/TommyKammy-codex-supervisor/issue-1008/context-index.md`; `sed -n '1,260p' .codex-supervisor/issue-journal.md`; `git status --short --branch`; `sed -n '1,240p' src/interrupted-turn-marker.ts`; `sed -n '260,380p' src/run-once-turn-execution.ts`; `sed -n '1080,1325p' src/recovery-reconciliation.ts`; `rg -n "hasDurableTurnUpdateSince|turn-in-progress|interrupted" src/run-once-turn-execution.test.ts src/supervisor/supervisor-execution-orchestration.test.ts src/recovery-reconciliation.ts src/run-once-turn-execution.ts src/interrupted-turn-marker.ts`; `sed -n '1,170p' src/recovery-reconciliation.ts`; `sed -n '620,830p' src/run-once-turn-execution.test.ts`; `sed -n '520,670p' src/supervisor/supervisor-execution-orchestration.test.ts`; `sed -n '560,660p' src/run-once-turn-execution.ts`; `rg -n "function readIssueJournalImpl|const readIssueJournalImpl|readIssueJournalImpl" src/run-once-turn-execution.ts src -g '!dist'`; `rg -n "reconcileStaleActiveIssueReservation\\(|hasDurableTurnUpdateSince\\(" src -g '!dist'`; `sed -n '380,760p' src/supervisor/supervisor-recovery-reconciliation.test.ts`; `sed -n '1,120p' src/run-once-turn-execution.ts`; `sed -n '1,220p' src/core/journal.ts`; `sed -n '1,120p' src/supervisor/supervisor-recovery-reconciliation.test.ts`; `npx tsx --test src/run-once-turn-execution.test.ts src/supervisor/supervisor-execution-orchestration.test.ts src/supervisor/supervisor-recovery-reconciliation.test.ts`; `git diff -- src/interrupted-turn-marker.ts src/run-once-turn-execution.ts src/recovery-reconciliation.ts src/run-once-turn-execution.test.ts src/supervisor/supervisor-execution-orchestration.test.ts`; `npm run build`.
- PR status: draft PR open at `https://github.com/TommyKammy/codex-supervisor/pull/1026`.
### Scratchpad
- Leave `.codex-supervisor/replay/` untracked; it is local replay output, not part of the fix.
