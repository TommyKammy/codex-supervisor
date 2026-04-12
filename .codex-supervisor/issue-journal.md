# Issue #1463: Prevent sparse cross-issue supervisor journals from blocking no-PR publication

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1463
- Branch: codex/issue-1463
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 0286d80db3fed1dd5a33805b1983b6f75505ccbf
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-04-12T21:51:51.637Z

## Latest Codex Summary
- None yet.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: sparse-checkout failures were coming from workstation-local path scanning reading every tracked file from disk, including cross-issue supervisor journals omitted from the current sparse workspace.
- What changed: added a sparse-checkout repro in publication-gate and path-scanner tests, then taught `findForbiddenWorkstationLocalPaths()` to skip tracked files that are absent from the working tree instead of throwing `ENOENT`.
- Current blocker: none.
- Next exact step: stage the scanner, regression tests, and this journal, then commit the sparse-workspace checkpoint on `codex/issue-1463`.
- Verification gap: focused regression suite and `npm run build` passed; no broader full-suite run beyond the issue-requested tests.
- Files touched: .codex-supervisor/issue-journal.md; src/turn-execution-publication-gate.test.ts; src/workstation-local-paths.test.ts; src/workstation-local-paths.ts
- Rollback concern: skipping `ENOENT` for tracked-but-absent files intentionally treats out-of-sparse artifacts as non-inspectable in the current workspace, so future callers should not rely on this scanner to report leaks from paths the sparse checkout has hidden.
- Last focused command: npm run build
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
