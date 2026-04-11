# Issue #1417: Publish sticky tracked-PR status comments for persistent merge-stage blockers

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1417
- Branch: codex/issue-1417
- Workspace: .
- Journal: .codex-supervisor/issues/1417/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: 767cb70fe938dfcc6ddb5f2afc738fac3f8eb564
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-04-11T00:33:44.650Z

## Latest Codex Summary
- Added focused post-turn coverage for persistent merge-stage tracked-PR sticky comments and implemented non-draft sticky comment publication for persistent manual-review, tracked lifecycle mismatch, and merge-readiness mismatch states.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: The existing sticky tracked-PR comment path only covers draft-stage blockers, so persistent merge-stage blockers like manual review and merge-readiness mismatch never surface on the PR timeline.
- What changed: Added two focused reproducing tests in `src/post-turn-pull-request.test.ts`, then extended `src/post-turn-pull-request.ts` to publish/update the same sticky `kind=status` comment for non-draft persistent manual-review blockers, tracked lifecycle mismatches, and merge-readiness mismatches after post-turn lifecycle refresh.
- Current blocker: none
- Next exact step: Commit the verified post-turn sticky-comment change set on `codex/issue-1417`.
- Verification gap: No dedicated coverage yet for a same-head tracked lifecycle mismatch comment body beyond the shared mismatch-derived helper path.
- Files touched: `src/post-turn-pull-request.ts`, `src/post-turn-pull-request.test.ts`, `.codex-supervisor/issues/1417/issue-journal.md`
- Rollback concern: The implementation reuses `last_host_local_pr_blocker_comment_*` dedupe fields for broader sticky-status comments, so reverting should restore the older draft/host-local-only publication behavior if comment churn appears.
- Last focused command: `npx tsx --test src/supervisor/supervisor-diagnostics-status-selection.test.ts src/doctor.test.ts src/post-turn-pull-request.test.ts src/recovery-reconciliation.test.ts`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
