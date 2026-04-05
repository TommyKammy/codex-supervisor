# Issue #1304: [codex] Detect invalid worktree-incompatible workspacePreparationCommand in setup readiness and doctor

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1304
- Branch: codex/issue-1304
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: d3b89e5e22167a74ec3049fe4b5472f2041885b3
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-04-05T23:07:58.287Z

## Latest Codex Summary
- Reproduced the gap with focused setup-readiness tests: repo-relative `workspacePreparationCommand` helpers under `repoPath` were not validated at all, so readiness stayed green and the field was absent even when the helper was missing or untracked.
- Added shared worktree-compatibility validation for repo-relative workspace-preparation helpers, surfaced `workspacePreparationCommand` as a setup-readiness field, and wired doctor config warnings to the same diagnosis. Focused tests and build now pass.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: repo-relative workspace preparation helpers need validation against the tracked repo contents before preserved issue worktrees attempt to run them.
- What changed: added shared validation in `src/core/config.ts` for repo-relative helper paths that are missing or untracked; setup readiness now includes `workspacePreparationCommand` and marks invalid helper cases as blocking config errors; doctor report tests cover the new config-warning text; setup config/fixture helpers were updated for the added readiness field.
- Current blocker: none.
- Next exact step: commit the validated implementation on `codex/issue-1304`, then open or update the draft PR if needed.
- Verification gap: no broader web UI regression pass yet beyond build and the focused readiness/doctor tests.
- Files touched: .codex-supervisor/issue-journal.md, src/core/config.ts, src/setup-readiness.ts, src/setup-readiness.test.ts, src/doctor.test.ts, src/setup-config-write.ts, src/setup-config-preview.ts, src/backend/setup-test-fixtures.ts
- Rollback concern: low; the change is additive and only flags repo-relative workspace-preparation helpers that would be absent from preserved worktrees.
- Last focused command: npx tsx --test src/setup-readiness.test.ts src/doctor.test.ts
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
- 2026-04-06: Reproduced the issue with new focused tests in `src/setup-readiness.test.ts` before implementation.
- 2026-04-06: Verified with `npx tsx --test src/setup-readiness.test.ts src/doctor.test.ts` and `npm run build`.
