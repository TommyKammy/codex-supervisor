# Issue #1412: Post deduplicated PR comments when tracked ready-promotion is blocked locally

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1412
- Branch: codex/issue-1412
- Workspace: .
- Journal: .codex-supervisor/issues/1412/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 895ce344f89239f32df89f9a0ad189ba79dca2d4
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-04-10T00:52:13.984Z

## Latest Codex Summary
- Reproduced the gap with a focused test: workstation-local path hygiene could block ready promotion without posting the existing deduplicated tracked-PR host-local blocker comment.
- Fixed the ready-promotion path to reuse `maybeCommentOnTrackedPrHostLocalBlocker(...)` for `workstation_local_path_hygiene`, with concise remediation-first comment text and existing `(head SHA, blocker signature)` dedupe state.
- Verified with targeted transition/recovery/status tests and `npm run build`.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: The tracked ready-promotion blocker comment gap existed because the workstation-local path hygiene gate returned before the tracked PR host-local comment helper was reused on that path.
- What changed: Added a focused regression test for deduplicated workstation-local path hygiene comments, extended tracked PR blocker comment rendering for `workstation_local_path_hygiene`, and hooked the existing dedupe helper into the actual ready-promotion path hygiene gate.
- Current blocker: none.
- Next exact step: Review the diff, then commit the source and journal changes on `codex/issue-1412`.
- Verification gap: Manual PR smoke test against a real tracked draft PR blocked by `npm run verify:paths` is still not exercised in this workspace.
- Files touched: `src/post-turn-pull-request.ts`, `src/post-turn-pull-request.test.ts`, `.codex-supervisor/issues/1412/issue-journal.md`.
- Rollback concern: Low; the change is scoped to tracked draft ready-promotion blocker comments and reuses existing dedupe state fields.
- Last focused command: `npm run build`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
