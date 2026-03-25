# Issue #973: Reconciliation resume: preserve tracked-merged-but-open progress across cycles

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/973
- Branch: codex/issue-973
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 3 (implementation=2, repair=1)
- Last head SHA: 0908cf364bd6f1a63a49d6efd5b16a8e82e3e0ea
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ852o6R_
- Repeated failure signature count: 1
- Updated at: 2026-03-25T07:59:55.950Z

## Latest Codex Summary
Pushed `codex/issue-973` and opened draft PR [#987](https://github.com/TommyKammy/codex-supervisor/pull/987). I also updated the issue journal handoff to record the pushed branch, PR state, and next stabilizing action, then committed that journal-only follow-up as `0908cf3`.

Tracked worktree files are clean; only the existing local `.codex-supervisor/pre-merge/` and `.codex-supervisor/replay/` directories remain untracked.

Summary: Pushed the issue branch, opened draft PR #987, updated the journal handoff, and pushed the journal-only follow-up commit `0908cf3`.
State hint: pr_open
Blocked reason: none
Tests: Not rerun after the journal-only handoff update; prior verified set remains `npx tsx --test src/run-once-cycle-prelude.test.ts src/supervisor/supervisor-recovery-reconciliation.test.ts`, `npx tsx --test src/core/state-store.test.ts --test-name-pattern "tracked merged reconciliation resume progress"`, and `npm run build`
Next action: Monitor draft PR #987 and address CI or review feedback if it arrives
Failure signature: PRRT_kwDORgvdZ852o6R_

## Active Failure Context
- Category: review
- Summary: 1 unresolved automated review thread(s) remain.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/987#discussion_r2986444251
- Details:
  - src/recovery-reconciliation.ts:166 _⚠️ Potential issue_ | _🟡 Minor_ **Don't restart from the front when the cursor record disappears.** If the persisted issue drops out of the PR-bearing set between cycles (for example, stale-branch cleanup cleared `pr_number`), `resumeIndex === -1` sends the sweep back to the front. Under a small `maxRecords`, that re-scans earlier records and delays the remaining tail even though the next record after the old cursor is still well-defined by issue number. <details> <summary>♻️ Proposed fix</summary> ```diff function orderTrackedMergedButOpenRecordsForResume( records: IssueRunRecord[], lastProcessedIssueNumber: number | null, ): IssueRunRecord[] { if (records.length <= 1 || lastProcessedIssueNumber === null) { return records; } const resumeIndex = records.findIndex((record) => record.issue_number === lastProcessedIssueNumber); - if (resumeIndex === -1) { + const nextIndex = + resumeIndex !== -1 + ? resumeIndex + 1 + : records.findIndex((record) => record.issue_number > lastProcessedIssueNumber); + if (nextIndex === -1 || nextIndex >= records.length) { return records; } return [ - ...records.slice(resumeIndex + 1), - ...records.slice(0, resumeIndex + 1), + ...records.slice(nextIndex), + ...records.slice(0, nextIndex), ]; } ``` </details> <!-- suggestion_start --> <details> <summary>📝 Committable suggestion</summary> > ‼️ **IMPORTANT** > Carefully review the code before committing. Ensure that it accurately replaces the highlighted code, contains no missing lines, and has no issues with indentation. Thoroughly test & benchmark the code to ensure it meets the requirements. ```suggestion const resumeIndex = records.findIndex((record) => record.issue_number === lastProcessedIssueNumber); const nextIndex = resumeIndex !== -1 ? resumeIndex + 1 : records.findIndex((record) => record.issue_number > lastProcessedIssueNumber); if (nextIndex === -1 || nextIndex >= records.length) { return records; } return [ ...records.slice(nextIndex), ...records.slice(0, nextIndex), ``` </details> <!-- suggestion_end --> <details> <summary>🤖 Prompt for AI Agents</summary> ``` Verify each finding against the current code and only fix it if needed. In `@src/recovery-reconciliation.ts` around lines 159 - 166, When resumeIndex === -1 in the rotation logic (computed from records.findIndex((record) => record.issue_number === lastProcessedIssueNumber)), don't fall back to starting at the front; instead locate the first record whose issue_number is greater than lastProcessedIssueNumber (e.g., records.findIndex(r => r.issue_number > lastProcessedIssueNumber)) and rotate from that index so the sweep resumes at the next logical issue; if that secondary search also yields -1 (cursor is beyond the current tail) just return records unchanged. This change keeps the pointer semantics based on issue_number and prevents re-scanning earlier records when the persisted cursor record has been removed. ``` </details> <!-- fingerprinting:phantom:medusa:grasshopper --> <!-- This is an auto-generated comment by CodeRabbit -->

## Codex Working Notes
### Current Handoff
- Hypothesis: bounded tracked-merged-but-open reconciliation still restarted from the front when the persisted cursor issue dropped out of the current PR-bearing set, because the resume helper only rotated when it found the exact saved issue number.
- What changed: updated `orderTrackedMergedButOpenRecordsForResume()` in `src/recovery-reconciliation.ts` to resume from the next higher issue number when the saved cursor record is no longer present, and added a focused regression in `src/supervisor/supervisor-recovery-reconciliation.test.ts` that proves a bounded sweep skips earlier records in that case instead of re-scanning from the front.
- Current blocker: none.
- Next exact step: monitor PR #987 for any follow-up CI or human review after pushing commit `7b6293e` and resolving the CodeRabbit thread.
- Verification gap: none in the requested local scope after rerunning `npx tsx --test src/run-once-cycle-prelude.test.ts src/supervisor/supervisor-recovery-reconciliation.test.ts` and `npm run build`.
- Files touched: `src/recovery-reconciliation.ts`, `src/supervisor/supervisor-recovery-reconciliation.test.ts`, `.codex-supervisor/issue-journal.md`.
- Rollback concern: low; the change only adjusts the internal rotation point for tracked merged-but-open reconciliation when the saved cursor record disappears, and leaves the existing full-pass and per-cycle budget semantics intact.
- Last focused command: `gh api graphql -f query='mutation($threadId:ID!){resolveReviewThread(input:{threadId:$threadId}){thread{isResolved}}}' -F threadId=PRRT_kwDORgvdZ852o6R_`
- Exact failure reproduced: with `maxRecords=1`, a saved cursor at issue #366 and current PR-bearing records for issues #365 and #367 caused the helper to restart at #365 instead of resuming at #367 after #366 dropped out of the tracked set.
- Commands run: `npx tsx --test src/run-once-cycle-prelude.test.ts src/supervisor/supervisor-recovery-reconciliation.test.ts`; `npm run build`; `git commit -m "Fix reconciliation resume fallback cursor"`; `git push origin codex/issue-973`; `gh api graphql -f query='mutation($threadId:ID!){resolveReviewThread(input:{threadId:$threadId}){thread{isResolved}}}' -F threadId=PRRT_kwDORgvdZ852o6R_`.
- PR status: draft PR #987 (`https://github.com/TommyKammy/codex-supervisor/pull/987`); the previously open CodeRabbit thread is resolved after pushing commit `7b6293e`.
### Scratchpad
- Leave `.codex-supervisor/replay/` untracked; it is local replay output, not part of the fix.
