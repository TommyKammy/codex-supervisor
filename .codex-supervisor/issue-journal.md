# Issue #1276: Avoid false positives when workstation-local path hygiene sees container paths like /home/node/.n8n

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1276
- Branch: codex/issue-1276
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: stabilizing
- Attempt count: 2 (implementation=2, repair=0)
- Last head SHA: ea962f52332c59d4594cdfde2a6730110b3f5822
- Blocked reason: none
- Last failure signature: handoff-missing
- Repeated failure signature count: 1
- Updated at: 2026-04-03T03:42:34.878Z

## Latest Codex Summary
- None yet.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: The false positive comes from treating every `/home/` path as a workstation path instead of classifying the home-owner segment.
- What changed: Added an owner-aware workstation path classifier, allowed the known container home `/home/node/`, enriched blocked diagnostics with a classification reason, and added direct regression tests for Linux/macOS/Windows workstation paths plus the `/home/node/.n8n` container case.
- Current blocker: none
- Next exact step: Commit the matcher/test changes, push `codex/issue-1276`, and open a draft PR if one does not already exist.
- Verification gap: No dedicated end-to-end supervisor phase test was rerun; validation is currently focused on the matcher, detector CLI, local CI slice, and `npm run build`.
- Files touched: `.codex-supervisor/issue-journal.md`, `scripts/check-workstation-local-paths.ts`, `src/workstation-local-path-gate.ts`, `src/workstation-local-paths.ts`, `src/workstation-local-paths.test.ts`
- Rollback concern: The `/home/node/` allowlist is intentionally narrow; if other container users need to be allowed later, expand it carefully to avoid weakening workstation-home detection.
- Last focused command: `npm run build`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
