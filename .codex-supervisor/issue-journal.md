# Issue #926: Post-merge promotion candidates: surface shared-memory and guardrail suggestions from recurring patterns

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/926
- Branch: codex/issue-926
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 66ed008de890b56d5c973f6be68570069aab3a71
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-24T11:08:43Z

## Latest Codex Summary
- None yet.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the persisted post-merge audit aggregate already exposed recurring review, failure, and recovery buckets, but it still lacked an explicit advisory layer that translated repeated patterns into promotion candidates operators could evaluate deliberately.
- What changed: extended `summarizePostMergeAuditPatterns` to emit advisory-only `promotionCandidates` derived from recurring review, failure, and recovery patterns; added category-specific candidates for `guardrail`, `shared_memory`, `checklist`, and `documentation`; preserved traceability through source pattern keys, supporting issue numbers, and supporting finding keys; updated the runtime DTO test for the new field.
- Current blocker: none.
- Next exact step: monitor draft PR #943 for review or CI follow-up on the promotion-candidate summary change.
- Verification gap: none in the current workspace after installing dependencies; the focused summary tests, full `src/**/*.test.ts` suite, and `npm run build` all passed.
- Files touched: `src/supervisor/post-merge-audit-summary.ts`, `src/supervisor/post-merge-audit-summary.test.ts`, `src/supervisor/post-merge-audit-summary-runtime.test.ts`, `.codex-supervisor/issue-journal.md`
- Rollback concern: low; reverting would only remove a read-only analysis surface and leave the persisted audit artifacts intact.
- Last focused command: `npx tsx --test src/**/*.test.ts`
- Last focused failure: the new reproducer initially failed with `TypeError: Cannot read properties of undefined (reading 'map')` because `summarizePostMergeAuditPatterns` did not return `promotionCandidates`; resolved by adding the new DTO field and derivation logic.
- Draft PR: #943 https://github.com/TommyKammy/codex-supervisor/pull/943
- Last focused commands:
```bash
npx tsx --test src/supervisor/post-merge-audit-summary.test.ts
npx tsx --test src/supervisor/post-merge-audit-summary-runtime.test.ts
npm install
npx tsx --test src/**/*.test.ts
npm run build
date -u +"%Y-%m-%dT%H:%M:%SZ"
git status --short
```
### Scratchpad
- Leave `.codex-supervisor/replay/` untracked; it is local replay output, not part of the fix.
