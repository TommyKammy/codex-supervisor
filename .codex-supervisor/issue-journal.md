# Issue #1621: Block supervisor-local durable artifacts before they enter checkpoint commits

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1621
- Branch: codex/issue-1621
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 09030f69df191789c4fe6d9470c0ff423fe49f25
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-04-21T22:24:20.741Z

## Latest Codex Summary
- None yet.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: PR publication should fail closed as soon as tracked supervisor-local `.codex-supervisor` artifacts are present, before path hygiene normalization, workspace preparation, or local CI can continue.
- What changed: Added an early tracked supervisor-artifact scan in the publication gate using the existing ignored-artifact path classifier; blocked tracked issue journals, replay/pre-merge/execution-metrics, and turn-in-progress artifacts with a precise remediation message; updated focused publication tests to cover tracked issue-journal and replay cases plus sparse-tracked journal blocking.
- Current blocker: none.
- Next exact step: commit the publication-gate changes on `codex/issue-1621`, then open or update the draft PR if needed.
- Verification gap: none for the requested local scope; focused tests and `npm run build` passed.
- Files touched: src/core/workspace.ts, src/turn-execution-publication-gate.ts, src/turn-execution-publication-gate.test.ts, .codex-supervisor/issue-journal.md
- Rollback concern: blocking current tracked issue-journal paths is stricter than the prior normalization behavior, so any workflow still relying on tracked live journals reaching draft PR publication will now stop earlier and require untracking/removal first.
- Last focused command: npm run build
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
