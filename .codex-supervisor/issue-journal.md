# Issue #1466: Add tmux-backed macOS loop launcher scripts

## Supervisor Snapshot
- Issue URL: https://github.com/TommyKammy/codex-supervisor/issues/1466
- Branch: codex/issue-1466
- Workspace: .
- Journal: .codex-supervisor/issue-journal.md
- Current phase: addressing_review
- Attempt count: 2 (implementation=1, repair=1)
- Last head SHA: cd8dfb1733e7d6bcb5aa9f9fcb1a344f0657ab22
- Blocked reason: none
- Last failure signature: PRRT_kwDORgvdZ856Zw2L
- Repeated failure signature count: 1
- Updated at: 2026-04-12T22:30:52.763Z

## Latest Codex Summary
Implemented the macOS `tmux` loop launcher path and kept the existing Linux/systemd flow unchanged. The branch now has `scripts/start-loop-tmux.sh` and `scripts/stop-loop-tmux.sh`, with a fixed default session name, idempotent `has-session` start behavior, explicit launcher metadata (`CODEX_SUPERVISOR_LAUNCHER=tmux`, `CODEX_SUPERVISOR_TMUX_SESSION`), and PATH/node/npm/config propagation into the tmux-hosted loop session. I also tightened [src/managed-restart-launcher-assets.test.ts](src/managed-restart-launcher-assets.test.ts) to cover the new script contract and explicit missing-`tmux` diagnostics.

The work is committed and pushed on `codex/issue-1466`, and draft PR `#1469` is open: https://github.com/TommyKammy/codex-supervisor/pull/1469

Summary: Added tmux-backed macOS loop launcher scripts, focused coverage, pushed commits, and opened draft PR #1469
State hint: draft_pr
Blocked reason: none
Tests: `npx tsx --test src/managed-restart-launcher-assets.test.ts`; `npm run build`
Next action: Watch draft PR #1469 for CI and review feedback, then address any follow-up on this branch
Failure signature: PRRT_kwDORgvdZ856Zw2L

## Active Failure Context
- Category: review
- Summary: 1 unresolved automated review thread(s) remain.
- Reference: https://github.com/TommyKammy/codex-supervisor/pull/1469#discussion_r3070262671
- Details:
  - scripts/start-loop-tmux.sh:31 summary=_⚠️ Potential issue_ | _🟠 Major_ 🧩 Analysis chain 🏁 Script executed: Repository: TommyKammy/codex-supervisor Length of output: 175 --- **Move the running-session check before... url=https://github.com/TommyKammy/codex-supervisor/pull/1469#discussion_r3070262671

## Codex Working Notes
### Current Handoff
- Hypothesis: The open CodeRabbit thread is valid because `scripts/start-loop-tmux.sh` currently validates `node`/`npm` before honoring an already-running tmux session, so the fix should move `has-session` ahead of that validation and lock the ordering down with an executable test.
- What changed: Reordered `scripts/start-loop-tmux.sh` so `tmux has-session` returns success before the `node`/`npm` availability check, preserving start idempotency for already-running sessions. Added a focused test in `src/managed-restart-launcher-assets.test.ts` that stubs `tmux`, removes `node`/`npm` from `PATH`, and asserts the script still exits successfully with the existing-session message.
- Current blocker: none
- Next exact step: Commit and push the review fix to `codex/issue-1466`, then watch PR #1469 for CI and reviewer follow-up.
- Verification gap: No live tmux integration run yet; verification remains focused on asset/runtime contract coverage plus `npm run build`.
- Files touched: .codex-supervisor/issue-journal.md; src/managed-restart-launcher-assets.test.ts; scripts/start-loop-tmux.sh; scripts/stop-loop-tmux.sh
- Rollback concern: Low; the change only adds new macOS helper scripts and test coverage, with no edits to existing Linux/systemd launcher paths.
- Last focused command: npx tsx --test src/managed-restart-launcher-assets.test.ts
### Scratchpad
- Review thread `PRRT_kwDORgvdZ856Zw2L` reported valid ordering bug in `scripts/start-loop-tmux.sh`.
- Commands run this turn: `gh auth status`; `gh pr view 1469 --json number,url,reviewDecision,isDraft,headRefName,baseRefName`; `npx tsx --test src/managed-restart-launcher-assets.test.ts`; `npm run build`.
