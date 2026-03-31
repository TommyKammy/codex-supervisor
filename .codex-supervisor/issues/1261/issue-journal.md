# Issue #1261: [codex] Strengthen operator visibility for host-local CI blockers on tracked PRs

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1261
- Branch: codex/issue-1261
- Workspace: .
- Journal: .codex-supervisor/issues/1261/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 5d94b584388e1bd69b010cd0c3d8cb9e14f2cf42
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-31T11:09:20.247Z

## Latest Codex Summary
- Added tracked-PR host-local CI blocker diagnostics to status and doctor so operators can see the local blocker even when GitHub checks are green, including failure class, remediation target, current head, and an explicit workspace-preparation gap when toolchain prerequisites are missing.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: Tracked PR steady-state diagnostics only surfaced a generic tracked PR mismatch, so operators could not tell that a green GitHub PR was still blocked by host-local CI or whether the fix belonged to the repo command, workspace environment, or supervisor setup.
- What changed: Added shared tracked-PR host-local CI detail lines in `src/supervisor/tracked-pr-mismatch.ts` and threaded them into both status and doctor output; added focused tests in status, doctor, and dashboard coverage. Restored missing local build tooling with `npm ci` so `npm run build` could complete in this worktree.
- Current blocker: none
- Next exact step: Review the diff, then commit the verified change set on `codex/issue-1261`.
- Verification gap: none for the requested checks; focused tests and build both pass after restoring local dependencies.
- Files touched: src/supervisor/tracked-pr-mismatch.ts; src/supervisor/supervisor.ts; src/doctor.ts; src/supervisor/supervisor-diagnostics-status-selection.test.ts; src/doctor.test.ts; src/backend/webui-dashboard.test.ts
- Rollback concern: Low; the change is additive diagnostics-only output, but line-format changes could affect downstream consumers that parse tracked PR mismatch detail lines.
- Last focused command: npm run build
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
