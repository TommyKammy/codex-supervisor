# Issue #1506: Epic auto-closure should fall back to canonical child lists in epic bodies

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1506
- Branch: codex/issue-1506
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 43774cdb67f50572eecf97a479e050a72aea277b
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-04-14T05:09:03.082Z

## Latest Codex Summary
- Added a narrow epic-body fallback for parent auto-closure by parsing only `## Child issues` sections with `- #<number>` bullets, while preserving child-side `Part of:` metadata as the primary path when present.
- Reproduced the gap with a focused `findParentIssuesReadyToClose` test, added a negative prose test, and refreshed two stale tracked-PR patch expectations so the requested verification suite passes.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: Parent epic auto-closure only derived relationships from child-side `Part of:` metadata, so epics with canonical child lists in the epic body never became closure candidates when children omitted `Part of:`.
- What changed: Added `parseCanonicalEpicChildIssueNumbers`, taught `findParentIssuesReadyToClose` to use a complete `## Child issues` bullet list as a fallback closure source, added focused positive/negative tests, and updated two stale `recovery-reconciliation.test.ts` expectations for existing blocker-observation fields.
- Current blocker: none
- Next exact step: Commit the verified fallback implementation and updated tests on `codex/issue-1506`.
- Verification gap: none for the requested local verification set; broader CI remains unrun locally beyond `npm run build`.
- Files touched: `.codex-supervisor/issue-journal.md`, `src/issue-metadata/issue-metadata-parser.ts`, `src/issue-metadata/issue-metadata.ts`, `src/issue-metadata/issue-metadata.test.ts`, `src/recovery-reconciliation.test.ts`
- Rollback concern: The fallback intentionally fails closed unless the epic body uses the exact `## Child issues` plus `- #<number>` shape and every referenced child is present in the inventory.
- Last focused command: `npx tsx --test src/issue-metadata/issue-metadata.test.ts src/run-once-cycle-prelude.test.ts src/recovery-reconciliation.test.ts`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
