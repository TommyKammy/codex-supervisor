# Issue #1609: Evaluate auto-requeue for transient no-PR codex failures with no meaningful branch diff

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1609
- Branch: codex/issue-1609
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: dd53cd3531d4bbace76892f823498a3b43c98faa
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-04-21T06:24:48.135Z

## Latest Codex Summary
- None yet.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: Safe `already_satisfied_on_main` failed no-PR workspaces should auto-requeue exactly once when preserved runtime evidence is transient and allowlisted, while unsafe states and later recurrences stay fail-closed on manual review.
- What changed: Added a transient-runtime allowlist at the failed no-PR reconciliation boundary, auto-requeueing the first safe `already_satisfied_on_main` recurrence and preserving later recurrences on manual review; added focused recovery plus explain/status regression coverage for the new path and updated older no-diff artifact expectations to the new one-time retry behavior.
- Current blocker: none
- Next exact step: Review the diff, commit the checkpoint on `codex/issue-1609`, and open or update the draft PR if needed.
- Verification gap: No extra gap in the requested local gates; broader suite coverage beyond the focused bundle was not run this turn.
- Files touched: .codex-supervisor/issue-journal.md; src/recovery-no-pr-reconciliation.ts; src/supervisor/supervisor-recovery-reconciliation.test.ts; src/supervisor/supervisor-diagnostics-explain.test.ts; src/supervisor/supervisor-diagnostics-status-selection.test.ts
- Rollback concern: The transient allowlist is intentionally narrow (`timeout` and `provider-capacity` via retained runtime evidence); widening it without new tests would weaken the fail-closed boundary.
- Last focused command: npm run build
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
