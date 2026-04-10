# Issue #1412: Post deduplicated PR comments when tracked ready-promotion is blocked locally

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1412
- Branch: codex/issue-1412
- Workspace: .
- Journal: .codex-supervisor/issues/1412/issue-journal.md
- Current phase: stabilizing
- Attempt count: 2 (implementation=2, repair=0)
- Last head SHA: 421253211507d9f018f19fa9fdff9d536f8c4afa
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-04-10T01:05:00.000Z

## Latest Codex Summary
Re-verified the existing implementation commit `4212532` (`Post deduped ready-promotion blocker comments`), pushed `codex/issue-1412`, and opened draft PR #1413. The code change remains scoped to [src/post-turn-pull-request.ts](src/post-turn-pull-request.ts) and [src/post-turn-pull-request.test.ts](src/post-turn-pull-request.test.ts), where tracked draft PRs now post a concise deduplicated top-level comment when `workstation_local_path_hygiene` blocks ready-for-review promotion.

The comment body is still remediation-first, explains that the PR remains draft because promotion is blocked locally, names the gate, summarizes the first-fix offenders, and states that rerunning the supervisor alone will not clear the blocker. Focused verification passed again on the committed checkpoint.

Verification ran clean:
`npx tsx --test src/post-turn-pull-request.test.ts src/recovery-reconciliation.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts`
`npm run build`

Summary: Re-verified the deduplicated tracked-PR ready-promotion blocker comment change, pushed the branch, and opened draft PR #1413.
State hint: draft_pr
Blocked reason: none
Tests: `npx tsx --test src/post-turn-pull-request.test.ts src/recovery-reconciliation.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts`; `npm run build`
Next action: Keep PR #1413 in draft pending manual smoke validation against a real tracked draft PR blocked by `npm run verify:paths`
Failure signature: none

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: The tracked ready-promotion blocker comment gap existed because the workstation-local path hygiene gate returned before the tracked PR host-local comment helper was reused on that path.
- What changed: Added a focused regression test for deduplicated workstation-local path hygiene comments, extended tracked PR blocker comment rendering for `workstation_local_path_hygiene`, and hooked the existing dedupe helper into the actual ready-promotion path hygiene gate.
- Current blocker: none.
- Next exact step: Run the manual smoke test against PR #1413 or hand off for review if that validation is deferred.
- Verification gap: Manual PR smoke test against a real tracked draft PR blocked by `npm run verify:paths` is still not exercised in this workspace.
- Files touched: `src/post-turn-pull-request.ts`, `src/post-turn-pull-request.test.ts`, `.codex-supervisor/issues/1412/issue-journal.md`.
- Rollback concern: Low; the change is scoped to tracked draft ready-promotion blocker comments and reuses existing dedupe state fields.
- Last focused commands: `npx tsx --test src/post-turn-pull-request.test.ts src/recovery-reconciliation.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts`; `npm run build`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
