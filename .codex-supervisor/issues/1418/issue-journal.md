# Issue #1418: Update sticky tracked-PR status comments on blocker changes and clear them without churn

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1418
- Branch: codex/issue-1418
- Workspace: .
- Journal: .codex-supervisor/issues/1418/issue-journal.md
- Current phase: stabilizing
- Attempt count: 2 (implementation=2, repair=0)
- Last head SHA: 8a78ffab8c36a33d7a507f155112027f6a7992ae
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-04-11T01:39:40.000Z

## Latest Codex Summary
Updated the tracked-PR sticky status flow in [src/post-turn-pull-request.ts](src/post-turn-pull-request.ts) so a previously published persistent blocker comment is updated once when the blocker clears and the PR resumes an active state. The clear path stores a `cleared:<state>` fingerprint on the current head, so repeated identical cycles do not churn the same comment. Draft suppression stays on its existing dedicated comment path.

Added focused coverage in [src/post-turn-pull-request.test.ts](src/post-turn-pull-request.test.ts) for both behaviors: updating the existing sticky comment when a persistent blocker clears, and not rewriting it again on the next identical cycle. I reran the issue verification commands, pushed `8a78ffa` to `origin/codex/issue-1418`, and opened draft PR [#1423](https://github.com/TommyKammy/codex-supervisor/pull/1423).

Summary: Sticky tracked-PR status comments now update on blocker clear and dedupe repeated cleared-state cycles.
State hint: draft_pr
Blocked reason: none
Tests: `npx tsx --test src/post-turn-pull-request.test.ts`; `npx tsx --test src/post-turn-pull-request.test.ts src/recovery-reconciliation.test.ts src/supervisor/supervisor-diagnostics-status-selection.test.ts src/doctor.test.ts`; `npm run build`; `git push -u origin codex/issue-1418`
Next action: Monitor draft PR #1423 and respond to CI or review feedback if it appears.
Failure signature: none

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: Sticky tracked-PR status comments deduped repeated blocker fingerprints, but there was no same-comment update path when a previously published persistent blocker cleared on the same head.
- What changed: Added cleared-status publishing for active tracked-PR states in `handlePostTurnPullRequestTransitionsPhase`, keyed by a stable `cleared:<state>` fingerprint so the existing sticky comment updates once on recovery without repeat churn. Added focused tests for clear-on-recovery and no-churn on repeated identical cycles. Pushed the branch and opened draft PR `#1423`.
- Current blocker: none
- Next exact step: Watch PR `#1423` for CI and review feedback; address any failures on `codex/issue-1418`.
- Verification gap: none for the scoped change; targeted suite and issue-listed verification command are green locally.
- Files touched: `src/post-turn-pull-request.ts`, `src/post-turn-pull-request.test.ts`, `.codex-supervisor/issues/1418/issue-journal.md`
- Rollback concern: Low; behavior only changes when a sticky tracked-PR status comment already exists on the current head and the PR resumes an active state.
- Last focused command: `gh pr create --draft --base main --head codex/issue-1418 --title '[codex] Update sticky tracked PR status comment clears' --body-file <tempfile>`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
