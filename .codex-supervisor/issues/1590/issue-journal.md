# Issue #1590: Honor managed-repo publishable path allowlists in verify:paths publication gate

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1590
- Branch: codex/issue-1590
- Workspace: .
- Journal: .codex-supervisor/issues/1590/issue-journal.md
- Current phase: addressing_review
- Attempt count: 2 (implementation=1, repair=1)
- Last head SHA: 4f955939e515859c850b339927c5d66f0e54ae9f
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ8577xsp|PRRT_kwDORgvdZ8577xsq
- Repeated failure signature count: 1
- Updated at: 2026-04-18T11:20:53.000Z

## Latest Codex Summary
Implemented the `publishablePathAllowlistMarkers` contract and wired it through the three relevant surfaces: `scripts/check-workstation-local-paths.ts`, the shared workstation-local path gate, and the publication / ready-promotion call sites. The suppression stays fail-closed by default, only applies to same-line tracked text matches when the operator config opts in, and does not widen trust for supervisor-owned or special durable-artifact handling.

Addressed the review finding that empty allowlist markers could create a fail-open suppression path by rejecting empty and whitespace-only `publishablePathAllowlistMarkers` entries during config parsing. Added focused regression coverage in `src/config.test.ts`, reran the targeted verification bundle plus `npm run build`, and committed the code checkpoint as `4f95593` (`Reject empty publishable allowlist markers`).

Summary: Rejected empty and whitespace-only publishable allowlist markers, added regression coverage, and kept the focused path-gate verification bundle plus build green.
State hint: addressing_review
Blocked reason: none
Tests: `npm run build`; `npx tsx --test src/post-turn-pull-request.test.ts src/turn-execution-publication-gate.test.ts src/workstation-local-path-detector.test.ts src/workstation-local-paths.test.ts src/config.test.ts`
Next action: push `codex/issue-1590`, then recheck and resolve the addressed review threads on PR `#1591`
Failure signature: none

## Active Failure Context
- Category: review
- Summary: Local review fixes are committed; pending step is to push the branch update and recheck PR thread state.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/1591#discussion_r3105054267
- Details:
  - `.codex-supervisor/issues/1590/issue-journal.md` refreshed to the current review-fix checkpoint and next PR action.
  - `src/core/config-parsing.ts` now rejects empty and whitespace-only allowlist markers; `src/config.test.ts` covers the regression.

## Codex Working Notes
### Current Handoff
- Hypothesis: The implementation is locally complete; the remaining review work is to publish the branch update and clear the two addressed PR threads.
- What changed: Rejected empty and whitespace-only `publishablePathAllowlistMarkers` entries in config parsing, added a focused config regression test, and refreshed the journal snapshot for the current review-fix checkpoint.
- Current blocker: none
- Next exact step: push `codex/issue-1590`, verify PR `#1591` reflects commit `4f95593`, and resolve or recheck the two CodeRabbit review threads.
- Verification gap: `npm test -- ...` package-script wrappers also run unrelated repo-wide tests with pre-existing failures; isolated verification used direct `npx tsx --test` on the touched suites plus `npm run build`.
- Files touched: `.codex-supervisor/issues/1590/issue-journal.md`; `scripts/check-workstation-local-paths.ts`; `src/core/types.ts`; `src/core/config-parsing.ts`; `src/workstation-local-paths.ts`; `src/workstation-local-path-gate.ts`; `src/turn-execution-publication-gate.ts`; `src/post-turn-pull-request.ts`; targeted tests under `src/`.
- Rollback concern: low; the new behavior is gated behind explicit config opt-in and still ignores markers for supervisor-owned/special durable artifact handling.
- Last focused command: `npx tsx --test src/post-turn-pull-request.test.ts src/turn-execution-publication-gate.test.ts src/workstation-local-path-detector.test.ts src/workstation-local-paths.test.ts src/config.test.ts`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
