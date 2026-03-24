# Issue #925: Post-merge audit analysis: summarize recurring review, recovery, and failure patterns

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/925
- Branch: codex/issue-925
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 3 (implementation=2, repair=1)
- Last head SHA: 1f32ea587b32039a64d8e50dc3c928d9f4ef7138
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ852YBEc
- Repeated failure signature count: 1
- Updated at: 2026-03-24T10:36:18Z

## Latest Codex Summary
I addressed the open CodeRabbit review on PR [#941](https://github.com/TommyKammy/codex-supervisor/pull/941) by making `summarizePostMergeAuditPatterns` tolerate persisted root-cause summaries that omit `findingsCount` or `findingKeys`. The aggregator now defaults missing evidence metadata to zero and an empty key list instead of throwing, and `src/supervisor/post-merge-audit-summary.test.ts` now covers the malformed-artifact case the review identified.

Focused verification for this repair is green: `npx tsx --test src/supervisor/post-merge-audit-summary.test.ts` and `npm run build`.

Summary: Repaired the PR #941 review finding by hardening post-merge audit summary aggregation against missing root-cause finding metadata
State hint: addressing_review
Blocked reason: none
Tests: `npx tsx --test src/supervisor/post-merge-audit-summary.test.ts`; `npm run build`
Next action: commit and push the review repair to `codex/issue-925`, then refresh PR #941
Failure signature: none

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: persisted post-merge audit artifacts already captured the raw review, recovery, and failure signals needed for recurring-pattern analysis, but there was no typed aggregate that operators could query without manually inspecting individual JSON files.
- What changed: repaired the `summarizePostMergeAuditPatterns` review-pattern reducer so persisted artifacts missing `findingsCount` or `findingKeys` no longer throw during aggregation; defaulted those fields to `0` and `[]` at read time and added a regression test that deletes both keys from a persisted root-cause summary before summarization.
- Current blocker: none.
- Next exact step: commit and push the review repair to `codex/issue-925`, then verify PR #941 reflects the updated branch head.
- Verification gap: none for the repair; focused test coverage and a clean TypeScript build both passed after the change.
- Files touched: `src/supervisor/post-merge-audit-summary.ts`, `src/supervisor/post-merge-audit-summary.test.ts`, `.codex-supervisor/issue-journal.md`
- Rollback concern: low; reverting would only remove a read-only analysis surface and leave the persisted audit artifacts intact.
- Last focused command: `npm run build`
- Last focused failure: `npm run build` initially failed because the new regression test deleted typed properties via a direct `Record<string, unknown>` cast; resolved by casting through `unknown` before deleting the fields.
- Draft PR: #941 https://github.com/TommyKammy/codex-supervisor/pull/941
- Last focused commands:
```bash
npx tsx --test src/supervisor/post-merge-audit-summary.test.ts
npm run build
date -u +"%Y-%m-%dT%H:%M:%SZ"
git diff -- src/supervisor/post-merge-audit-summary.ts src/supervisor/post-merge-audit-summary.test.ts .codex-supervisor/issue-journal.md
```
### Scratchpad
- Leave `.codex-supervisor/replay/` untracked; it is local replay output, not part of the fix.
