# Issue #1489: Same-head stale verification blockers can stay authoritative when only last_head_sha is current

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1489
- Branch: codex/issue-1489
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 3221a66cd050ac8eafed054e09c12935541c333d
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-04-13T18:33:54.162Z

## Latest Codex Summary
- None yet.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: Same-head draft `blocked/verification` records should only stay authoritative when fresh current-head blocker evidence still exists; `last_head_sha` by itself is insufficient.
- What changed: Added a shared tracked-PR ready-promotion blocker freshness helper; reconciliation now clears stale same-head verification blockers without fresh evidence, and diagnostics (`status`, `explain`, `doctor`) now use the same rule for stale guidance. Added same-head stale regression coverage plus same-head current-evidence control remains covered.
- Current blocker: none
- Next exact step: Commit the focused reconciliation/diagnostics change set on `codex/issue-1489`.
- Verification gap: none for the requested focused tests and build.
- Files touched: `src/tracked-pr-ready-promotion-blocker.ts`, `src/recovery-reconciliation.ts`, `src/supervisor/tracked-pr-mismatch.ts`, `src/supervisor/supervisor-recovery-reconciliation.test.ts`, `src/supervisor/supervisor-diagnostics-status-selection.test.ts`, `src/supervisor/supervisor-diagnostics-explain.test.ts`, `src/doctor.test.ts`, `.codex-supervisor/issue-journal.md`
- Rollback concern: If the freshness helper is too strict, same-head blockers that only persist via non-comment/non-local-CI evidence could be cleared early; current tests cover current-head local CI and current-head stale/no-evidence cases.
- Last focused command: `npm run build`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
