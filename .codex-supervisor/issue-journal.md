# Issue #955: Audit traceability guard: preserve full supporting evidence until final summary and promotion derivation

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/955
- Branch: codex/issue-955
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 78efe2e86f614698ce30302a776393a9aada4374
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-25T00:34:00.000Z

## Latest Codex Summary
- Tightened the post-merge audit summary contract so downstream derivation reads explicit full supporting evidence instead of presentation-shaped `example*` fields. Bumped the summary schema to 3, updated focused audit-summary regressions and typed runtime/server fixtures, then reran the requested audit-summary tests and `npm run build` after restoring dependencies with `npm ci`.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: the audit summary pipeline was preserving full evidence in memory but exposing it through `exampleIssueNumbers` and `exampleFindingKeys`, so promotion derivation depended on presentation-shaped fields that could be safely sampled later and lose traceability.
- What changed: updated `src/supervisor/post-merge-audit-summary.ts` so review, failure, and recovery pattern DTOs carry explicit `supportingIssueNumbers` and `supportingFindingKeys`, and promotion candidates derive from those full-support fields; bumped the summary schema version from 2 to 3; refreshed `src/supervisor/post-merge-audit-summary.test.ts`, `src/supervisor/post-merge-audit-summary-runtime.test.ts`, and `src/backend/supervisor-http-server.test.ts` to assert the new contract.
- Current blocker: none.
- Next exact step: commit the issue-955 traceability fix, then open or update the draft PR from `codex/issue-955`.
- Verification gap: none in the requested scope; `npx tsx --test src/supervisor/post-merge-audit-summary.test.ts src/supervisor/post-merge-audit-summary-runtime.test.ts` and `npm run build` passed after `npm ci`.
- Files touched: `src/supervisor/post-merge-audit-summary.ts`, `src/supervisor/post-merge-audit-summary.test.ts`, `src/supervisor/post-merge-audit-summary-runtime.test.ts`, `src/backend/supervisor-http-server.test.ts`, `.codex-supervisor/issue-journal.md`.
- Rollback concern: medium-low; schema consumers now require version 3, so rollback would need the fixtures and validator to move back together.
- Last focused command: `npx tsx --test src/supervisor/post-merge-audit-summary.test.ts src/supervisor/post-merge-audit-summary-runtime.test.ts && npm run build`
- PR status: no PR opened from `codex/issue-955` yet in this turn.
### Scratchpad
- Leave `.codex-supervisor/replay/` untracked; it is local replay output, not part of the fix.
