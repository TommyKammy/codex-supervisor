# Issue #1165: Do not hard-block selection on a transient full-inventory refresh failure when a fresh snapshot exists

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1165
- Branch: codex/issue-1165
- Workspace: .
- Journal: .codex-supervisor/issues/1165/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 4ec11ba9e8fd150d385b98fd41a67e582a8ff437
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-28T13:17:55.424Z

## Latest Codex Summary
- Reproduced the over-blocking gap with a focused prelude test and changed the prelude to allow one snapshot-backed selection pass after a transient full-inventory refresh failure when a fresh last-known-good snapshot exists. Repeated transient failures remain blocked.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: The hard block lives in `runOnceCyclePrelude` returning immediately on any full-inventory refresh failure, even when the failure is transient and the previous cycle left behind a fresh trusted snapshot.
- What changed: Added a focused regression test for transient-failure snapshot-backed selection, added a helper that recognizes fresh snapshot support for transient GitHub transport failures, and let the prelude attempt `reserveRunnableIssueSelection` once in that bounded case. Added a second test to keep repeated transient failures blocked.
- Current blocker: none
- Next exact step: Commit the focused prelude/inventory changes on `codex/issue-1165`, then continue with any higher-signal status/readiness follow-up only if review finds an operator-surface mismatch.
- Verification gap: `npm test -- src/run-once-cycle-prelude.test.ts` was misleading because the package script still expands to the full glob and hit an unrelated browser-smoke failure; targeted verification used `npx tsx --test src/run-once-cycle-prelude.test.ts` instead.
- Files touched: `src/inventory-refresh-state.ts`, `src/run-once-cycle-prelude.ts`, `src/run-once-cycle-prelude.test.ts`
- Rollback concern: The freshness window is currently a fixed one-hour bound; if operator expectations require a different tolerance, adjust the helper rather than broadening the transient-failure path.
- Last focused command: `npx tsx --test src/run-once-cycle-prelude.test.ts`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
