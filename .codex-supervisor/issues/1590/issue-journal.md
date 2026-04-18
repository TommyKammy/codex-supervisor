# Issue #1590: Honor managed-repo publishable path allowlists in verify:paths publication gate

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1590
- Branch: codex/issue-1590
- Workspace: .
- Journal: .codex-supervisor/issues/1590/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: b25f7833d4f1d0d3fbfd8cf67d4d749d1a1216cd
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-04-18T11:00:06.002Z

## Latest Codex Summary
- None yet.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: `verify:paths` and the publication gates need the same line-level marker contract, sourced from supervisor config, so managed-repo fixture allowlists stay opt-in and fail closed elsewhere.
- What changed: Added optional `publishablePathAllowlistMarkers` config parsing, taught the detector/gate/CLI to suppress only same-line tracked text matches containing a configured marker, and added regression coverage for detector semantics plus publication and ready-promotion gate plumbing.
- Current blocker: none
- Next exact step: stage the changed source/test files, exclude generated `.codex-supervisor/` runtime artifacts, and commit the checkpoint for issue `#1590`.
- Verification gap: `npm test -- ...` package-script wrappers also run unrelated repo-wide tests with pre-existing failures; isolated verification used direct `npx tsx --test` on the touched suites plus `npm run build`.
- Files touched: `scripts/check-workstation-local-paths.ts`; `src/core/types.ts`; `src/core/config-parsing.ts`; `src/workstation-local-paths.ts`; `src/workstation-local-path-gate.ts`; `src/turn-execution-publication-gate.ts`; `src/post-turn-pull-request.ts`; targeted tests under `src/`.
- Rollback concern: low; the new behavior is gated behind explicit config opt-in and still ignores markers for supervisor-owned/special durable artifact handling.
- Last focused command: `npx tsx --test src/post-turn-pull-request.test.ts src/turn-execution-publication-gate.test.ts src/workstation-local-path-detector.test.ts src/workstation-local-paths.test.ts src/config.test.ts`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
