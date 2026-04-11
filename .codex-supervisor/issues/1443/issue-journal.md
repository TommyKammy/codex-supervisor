# Issue #1443: Improve tracked-PR self-healing after supervisor downtime

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1443
- Branch: codex/issue-1443
- Workspace: .
- Journal: .codex-supervisor/issues/1443/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: bc56de43bcb93bbf0eb16c51535434207f10c08c
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-04-11T22:14:39.190Z

## Latest Codex Summary
- None yet.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: Post-downtime tracked PR state was only self-healing for merged, failed, and some blocked records; open tracked PR records left in active lifecycle states could stay stale until a later full loop action.
- What changed: Added bounded tracked-PR lifecycle refresh for open PR records in active tracked-PR states during merged/open reconciliation, updated mismatch guidance to point operators at a one-shot `run-once --dry-run` refresh path, and added regression coverage for run-once and reconciliation cursor behavior.
- Current blocker: none
- Next exact step: Commit the verified checkpoint and, if desired by the supervisor flow, open or update a draft PR for `codex/issue-1443`.
- Verification gap: The full `src/supervisor/supervisor-execution-orchestration.test.ts` suite still contains a pre-existing unrelated stale no-PR test failure outside this tracked-PR issue scope; the targeted tracked-PR regressions and the issue's required verification commands passed.
- Files touched: src/recovery-tracked-pr-reconciliation.ts; src/supervisor/tracked-pr-mismatch.ts; src/supervisor/supervisor-execution-orchestration.test.ts; src/supervisor/supervisor-recovery-reconciliation.test.ts; src/supervisor/supervisor-diagnostics-status-selection.test.ts; src/supervisor/supervisor-diagnostics-explain.test.ts
- Rollback concern: The new refresh path is intentionally limited to open tracked PR records whose authoritative GitHub lifecycle state differs from the local active state, to avoid disturbing same-state retry accounting.
- Last focused command: npx tsx --test src/supervisor/supervisor-recovery-reconciliation.test.ts
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
