# Issue #1275: Improve diagnostics when a tracked PR is waiting on CI/review signals the repo cannot produce yet

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1275
- Branch: codex/issue-1275
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: ae50bab6df620055f78f30a1f707fa78509aba91
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-04-03T12:38:00.624Z

## Latest Codex Summary
- None yet.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: The tracked-PR diagnostics only classified "missing provider signal" and "checks=none", so bootstrap repos with no workflows/check runs were being reported like a PR-specific wait instead of a repo capability mismatch.
- What changed: Added `external_signal_readiness` diagnostics that classify CI and configured review-provider readiness using current PR facts plus local workflow presence, surfaced the line in `status` and `explain`, and added focused regressions for the bootstrap no-workflows/no-checks/no-provider-signal case.
- Current blocker: none
- Next exact step: Commit the diagnostic change set on `codex/issue-1275`.
- Verification gap: none for the requested focused suite and TypeScript build; no broader end-to-end GitHub live run was performed.
- Files touched: .codex-supervisor/issue-journal.md; src/supervisor/supervisor-detailed-status-assembly.ts; src/supervisor/supervisor-diagnostics-explain.test.ts; src/supervisor/supervisor-diagnostics-status-selection.test.ts; src/supervisor/supervisor-selection-issue-explain.ts; src/supervisor/supervisor-status-rendering-supervisor.test.ts; src/supervisor/supervisor-status-review-bot.test.ts; src/supervisor/supervisor-status-review-bot.ts
- Rollback concern: The new readiness classification uses local `.github/workflows/*` presence as a diagnostic heuristic; if a repo emits external checks without committed workflows, the line could over-classify that case as repo-not-configured.
- Last focused command: npm run build
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
