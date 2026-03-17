# Issue #467: CodeRabbit initial grace wait: explain the startup wait in status output and docs

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/467
- Branch: codex/issue-467
- Workspace: /home/tommy/Dev/codex-supervisor-self-worktrees/issue-467
- Journal: /home/tommy/Dev/codex-supervisor-self-worktrees/issue-467/.codex-supervisor/issue-journal.md
- Current phase: reproducing
- Attempt count: 1 (implementation=1, repair=0)
- Last head SHA: d50281408c415e82802fde6fa794e096118f4e63
- Blocked reason: none
- Last failure signature: none
- Repeated failure signature count: 0
- Updated at: 2026-03-17T10:58:14Z

## Latest Codex Summary
- Added explicit `configured_wait_seconds` reporting to the active CodeRabbit initial-grace and settled-wait status lines, updated focused status-output tests, and expanded CodeRabbit docs so operators can distinguish the startup grace from the later settled wait.

## Active Failure Context
- None recorded.

## Codex Working Notes
### Current Handoff
- Hypothesis: The distinct CodeRabbit startup grace wait already existed in state/status logic, but the active status line still hid the configured duration, so operators had to infer a tuned 60-120 second pause from timestamps alone.
- What changed: Added `configuredWaitSeconds` to the active CodeRabbit initial-grace and settled-wait status helpers, rendered it as `configured_wait_seconds=...` in detailed status output, tightened the focused status-output tests around that field, and updated the CodeRabbit docs/getting-started text to explain the startup grace, why it exists, and how it differs from the later settled wait.
- Current blocker: none
- Next exact step: Stage the focused status/docs updates and create a checkpoint commit on `codex/issue-467`.
- Verification gap: none for local focused verification; remote CI has not run yet.
- Files touched: `src/supervisor/supervisor-status-review-bot.ts`, `src/supervisor/supervisor-detailed-status-assembly.ts`, `src/supervisor/supervisor-status-review-bot.test.ts`, `src/supervisor/supervisor-status-model-supervisor.test.ts`, `src/supervisor/supervisor-status-rendering-supervisor.test.ts`, `docs/configuration.md`, `docs/getting-started.md`
- Rollback concern: reverting this issue should remove only the explicit duration/status wording updates; the underlying CodeRabbit initial grace timing behavior belongs to the earlier dependency work.
- Last focused command: `npm run build`
### Scratchpad
- Keep this section short. The supervisor may compact older notes automatically.
- Reproducing signature before the fix: required current-head CI completion metadata was absent from configured-bot hydration, so no stable `currentHeadCiGreenAt` value existed for later CodeRabbit provider-start wait logic.
- Focused derivation rule: use the latest completion timestamp among required current-head checks, but only when every required current-head check on the tracked head is already passing/skipping; otherwise leave the field null.
- Verification commands: `npx tsx --test src/supervisor/supervisor-status-review-bot.test.ts src/supervisor/supervisor-status-model-supervisor.test.ts src/supervisor/supervisor-status-rendering-supervisor.test.ts`; `npm ci`; `npm run build`.
- Local failure resolved: `npm run build` initially failed with `sh: 1: tsc: not found` because this worktree was missing `node_modules`; `npm ci` restored the local toolchain and the acceptance build passed afterward.
- 2026-03-17: Focused reproducer was `inferStateFromPullRequest` returning `ready_to_merge` instead of `waiting_ci` when `currentHeadCiGreenAt=2026-03-13T02:05:00Z`, CodeRabbit was configured, and no `configuredBotCurrentHeadObservedAt` existed. The new initial grace wait covers that silent-provider window and hands off to the existing settled wait once `configuredBotCurrentHeadObservedAt` appears.
- 2026-03-17: Focused reproducer for this issue was the active status output omitting the configured wait length. Tightened tests expected `configured_wait_seconds=90` on `configured_bot_initial_grace_wait` and `configured_wait_seconds=5` on `configured_bot_settled_wait`; those failed before the status helper/assembly update and now pass.
